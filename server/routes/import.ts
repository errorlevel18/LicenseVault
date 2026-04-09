import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middlewares/validationMiddleware';
import logger from '../utils/logger';
import db from '../database';
import { withTransaction } from '../utils/error-handler';
import { environments, featureStats, hosts, instances, pdbs } from '../../shared/schema';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// ===== Oracle Driver Mode Management =====
// Thick mode: uses Oracle Client libraries, compatible with ALL Oracle versions (10g+)
// Thin mode: pure JS, no Oracle Client needed, but only supports Oracle 12.1+

let oracleDriverMode: 'uninitialized' | 'thin' | 'thick' | 'unavailable' = 'uninitialized';

async function initOracleDriver(): Promise<string> {
  if (oracleDriverMode !== 'uninitialized') return oracleDriverMode;
  
  let oracledb: any;
  try {
    oracledb = await import('oracledb');
  } catch (err) {
    oracleDriverMode = 'unavailable';
    logger.warn('oracledb package is not installed. Oracle import features will be unavailable. Install it with: npm install oracledb');
    return oracleDriverMode;
  }
  
  // Try to initialize Thick mode for maximum version compatibility
  // Check common Oracle Client locations
  const candidatePaths: string[] = [];
  
  // Environment variable paths
  if (process.env.ORACLE_HOME) {
    candidatePaths.push(path.join(process.env.ORACLE_HOME, 'bin'));
    candidatePaths.push(process.env.ORACLE_HOME);
  }
  if (process.env.ORACLE_CLIENT) {
    candidatePaths.push(process.env.ORACLE_CLIENT);
  }
  
  // Common Windows Instant Client locations
  const drives = ['C:', 'D:', 'E:'];
  for (const drv of drives) {
    candidatePaths.push(`${drv}\\oracle\\instantclient_21_3`);
    candidatePaths.push(`${drv}\\oracle\\instantclient_19_8`);
    candidatePaths.push(`${drv}\\oracle\\instantclient_19_3`);
    candidatePaths.push(`${drv}\\oracle\\instantclient`);
    candidatePaths.push(`${drv}\\instantclient_21_3`);
    candidatePaths.push(`${drv}\\instantclient_19_8`);
    candidatePaths.push(`${drv}\\instantclient`);
    candidatePaths.push(`${drv}\\app\\oracle\\product\\19.0.0\\client_1`);
    candidatePaths.push(`${drv}\\app\\oracle\\product\\12.2.0\\client_1`);
    candidatePaths.push(`${drv}\\app\\oracle\\product\\11.2.0\\client_1`);
  }
  // Common Linux paths
  candidatePaths.push('/usr/lib/oracle/21/client64/lib');
  candidatePaths.push('/usr/lib/oracle/19.8/client64/lib');
  candidatePaths.push('/usr/lib/oracle/19.3/client64/lib');
  candidatePaths.push('/opt/oracle/instantclient_21_3');
  candidatePaths.push('/opt/oracle/instantclient_19_8');
  candidatePaths.push('/opt/oracle/instantclient');
  
  // Try without explicit path first (uses system PATH / LD_LIBRARY_PATH)
  try {
    oracledb.default.initOracleClient();
    oracleDriverMode = 'thick';
    logger.info('Oracle Thick mode initialized (from system PATH). All Oracle versions supported.');
    return oracleDriverMode;
  } catch (_) {
    // Not in PATH, try explicit paths
  }
  
  // Try each candidate path
  for (const libDir of candidatePaths) {
    try {
      if (fs.existsSync(libDir)) {
        oracledb.default.initOracleClient({ libDir });
        oracleDriverMode = 'thick';
        logger.info(`Oracle Thick mode initialized from: ${libDir}. All Oracle versions supported.`);
        return oracleDriverMode;
      }
    } catch (_) {
      // Try next path
    }
  }
  
  // Fall back to Thin mode
  oracleDriverMode = 'thin';
  logger.info('Oracle Thick mode not available (no Oracle Client libraries found). Using Thin mode (Oracle 12.1+ only).');
  return oracleDriverMode;
}

// Schema for Oracle connection test + data import
const oracleConnectionSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({
    hostname: z.string().min(1, 'Hostname is required'),
    port: z.number().int().min(1).max(65535).default(1521),
    serviceName: z.string().min(1, 'Service name is required'),
    username: z.string().min(1, 'Username is required'),
    password: z.string().min(1, 'Password is required'),
    useSID: z.boolean().optional().default(false),
  }),
});

const importedFeatureSchema = z.object({
  name: z.string().min(1, 'Feature name is required'),
  currentlyUsed: z.boolean(),
  detectedUsages: z.number().optional().default(0),
  firstUsageDate: z.string().nullable().optional(),
  lastUsageDate: z.string().nullable().optional(),
});

const importedPdbSchema = z.object({
  name: z.string().min(1, 'PDB name is required'),
  openMode: z.string().optional(),
});

const importedInstanceSchema = z.object({
  name: z.string().min(1, 'Instance name is required'),
  hostName: z.string().optional(),
  status: z.string().optional(),
  cpu: z.object({
    numCores: z.string().optional(),
  }).optional(),
});

const importedOracleDataSchema = z.object({
  database: z.object({
    name: z.string().optional(),
    uniqueName: z.string().optional(),
    version: z.string().optional(),
    versionShort: z.string().optional(),
    banner: z.string().optional(),
    edition: z.string().optional(),
    dbType: z.string().optional(),
    envType: z.string().optional(),
    isRAC: z.boolean().optional(),
    isDataGuard: z.boolean().optional(),
  }).passthrough(),
  localInstanceName: z.string().optional(),
  instances: z.array(importedInstanceSchema).default([]),
  cpu: z.object({
    numCores: z.string().optional(),
  }).optional(),
  highWaterMark: z.object({
    cpuCoreCount: z.string().nullable().optional(),
  }).nullable().optional(),
  features: z.array(importedFeatureSchema).default([]),
  pdbs: z.array(importedPdbSchema).default([]),
});

const environmentConflictSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({
    customerId: z.string().min(1, 'Customer ID is required'),
    environmentName: z.string().min(1, 'Environment name is required'),
    isRAC: z.boolean().optional().default(false),
  }),
});

const saveOracleImportSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({
    customerId: z.string().min(1, 'Customer ID is required'),
    hostname: z.string().min(1, 'Hostname is required'),
    port: z.number().int().min(1).max(65535),
    serviceName: z.string().min(1, 'Service name is required'),
    primaryUse: z.string().min(1, 'Primary use is required'),
    hostAssignments: z.record(z.string().min(1)).default({}),
    importData: importedOracleDataSchema,
  }),
});

type ImportedOracleData = z.infer<typeof importedOracleDataSchema>;

function getEnvironmentNameFromImport(importData: ImportedOracleData) {
  return (
    importData.database.name?.trim() ||
    importData.database.uniqueName?.trim() ||
    importData.instances[0]?.name ||
    'Imported Oracle Environment'
  );
}

function getDisplayInstances(importData: ImportedOracleData) {
  if (importData.database.isRAC && importData.localInstanceName) {
    return importData.instances.filter((instance) => instance.name === importData.localInstanceName);
  }

  return importData.instances;
}

function getVersionLabel(importData: ImportedOracleData) {
  const majorVersion =
    Number.parseInt(importData.database.version || '', 10) ||
    Number.parseInt(importData.database.versionShort || '', 10);

  if (majorVersion > 0) {
    return String(majorVersion);
  }

  return importData.database.versionShort || importData.database.version || 'Unknown';
}

async function findDuplicateEnvironment(customerId: string, environmentName: string) {
  const matches = await db
    .select()
    .from(environments)
    .where(
      and(
        eq(environments.customerId, customerId),
        sql`lower(${environments.name}) = lower(${environmentName})`,
      ),
    )
    .limit(1)
    .execute();

  return matches[0];
}

async function buildDuplicateEnvironmentResponse(customerId: string, environmentName: string, isRAC: boolean) {
  const duplicate = await findDuplicateEnvironment(customerId, environmentName);

  if (!duplicate) {
    return null;
  }

  const existingInstances = await db
    .select({ name: instances.name })
    .from(instances)
    .where(eq(instances.environmentId, duplicate.id))
    .execute();

  return {
    id: duplicate.id,
    name: duplicate.name,
    isRAC,
    existingInstances: existingInstances.map((instance) => instance.name),
  };
}

async function upsertImportedFeatureStats(tx: any, environmentId: string, importedFeatures: ImportedOracleData['features']) {
  const existingFeatureStats = await tx
    .select()
    .from(featureStats)
    .where(eq(featureStats.environmentId, environmentId))
    .execute();

  const existingFeatureMap = new Map<string, any>(existingFeatureStats.map((feature: any) => [feature.name.toLowerCase(), feature]));

  for (const feature of importedFeatures) {
    const existingFeature = existingFeatureMap.get(feature.name.toLowerCase());

    if (existingFeature) {
      await tx
        .update(featureStats)
        .set({
          currentlyUsed: feature.currentlyUsed,
          detectedUsages: feature.detectedUsages || 0,
          firstUsageDate: feature.firstUsageDate,
          lastUsageDate: feature.lastUsageDate,
          status: 'Not Licensed',
          updatedAt: new Date().toISOString(),
        })
        .where(eq(featureStats.id, existingFeature.id))
        .execute();
    } else {
      await tx
        .insert(featureStats)
        .values({
          environmentId,
          name: feature.name,
          currentlyUsed: feature.currentlyUsed,
          detectedUsages: feature.detectedUsages || 0,
          firstUsageDate: feature.firstUsageDate,
          lastUsageDate: feature.lastUsageDate,
          status: 'Not Licensed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .execute();
    }
  }
}

async function upsertImportedPdbs(tx: any, environmentId: string, importedPdbs: ImportedOracleData['pdbs']) {
  if (!importedPdbs.length) {
    return;
  }

  const existingPdbs = await tx
    .select()
    .from(pdbs)
    .where(eq(pdbs.environmentId, environmentId))
    .execute();

  const existingPdbMap = new Map<string, any>(existingPdbs.map((pdbRecord: any) => [pdbRecord.name.toLowerCase(), pdbRecord]));

  for (const pdbRecord of importedPdbs) {
    const existingPdb = existingPdbMap.get(pdbRecord.name.toLowerCase());

    if (existingPdb) {
      await tx
        .update(pdbs)
        .set({
          status: pdbRecord.openMode || existingPdb.status || 'Open',
          updatedAt: new Date().toISOString(),
        })
        .where(eq(pdbs.id, existingPdb.id))
        .execute();
    } else {
      await tx
        .insert(pdbs)
        .values({
          id: uuidv4(),
          environmentId,
          name: pdbRecord.name,
          status: pdbRecord.openMode || 'Open',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .execute();
    }
  }
}

function getUserCustomerAccess(req: any, customerId: string) {
  const user = req.user as { id: string; role: 'admin' | 'customer'; customerId?: string } | undefined;
  const isAdmin = user?.role === 'admin';
  const userCustomerId = user?.role === 'customer' ? user.id : user?.customerId;

  if (!isAdmin && customerId !== userCustomerId) {
    const error: any = new Error('Unauthorized access to this customer import flow');
    error.status = 403;
    throw error;
  }
}

// Helper: quick TCP port check (validates network reachability before Oracle handshake)
function checkTcpPort(host: string, port: number, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}

// Helper: get an oracledb connection (auto-detects Thick/Thin mode)
async function getOracleConnection(config: {
  hostname: string;
  port: number;
  serviceName: string;
  username: string;
  password: string;
  useSID?: boolean;
}) {
  // Initialize driver mode on first call
  const mode = await initOracleDriver();
  if (mode === 'unavailable') {
    throw new Error('The oracledb package is not installed. Install it with: npm install oracledb');
  }
  
  const oracledb = await import('oracledb');
  
  // Build TNS descriptor connect string
  let connectString: string;
  
  if (config.useSID) {
    connectString = `(DESCRIPTION=(CONNECT_TIMEOUT=15)(TRANSPORT_CONNECT_TIMEOUT=5)(ADDRESS=(PROTOCOL=TCP)(HOST=${config.hostname})(PORT=${config.port}))(CONNECT_DATA=(SID=${config.serviceName})))`;
  } else {
    connectString = `(DESCRIPTION=(CONNECT_TIMEOUT=15)(TRANSPORT_CONNECT_TIMEOUT=5)(ADDRESS=(PROTOCOL=TCP)(HOST=${config.hostname})(PORT=${config.port}))(CONNECT_DATA=(SERVICE_NAME=${config.serviceName})))`;
  }
  
  logger.info(`Connecting to Oracle [${mode} mode]: ${config.username}@${config.hostname}:${config.port}/${config.serviceName} (${config.useSID ? 'SID' : 'Service Name'})`);
  
  const connection = await oracledb.default.getConnection({
    user: config.username,
    password: config.password,
    connectString,
  });
  
  return { connection, mode };
}

// Test connection endpoint
router.post('/test-connection', validateRequest(oracleConnectionSchema), async (req, res, next) => {
  let connection: any = null;
  try {
    const { hostname, port, serviceName, username, password, useSID } = req.body;
    
    // Step 1: Quick TCP port check
    logger.info(`Testing TCP connectivity to ${hostname}:${port}...`);
    const tcpOk = await checkTcpPort(hostname, port, 5000);
    
    if (!tcpOk) {
      return res.status(400).json({
        success: false,
        message: `Cannot reach ${hostname}:${port} — TCP connection refused or timed out. Check firewall, VPN, or hostname.`,
        diagnostic: 'TCP_UNREACHABLE'
      });
    }
    
    logger.info(`TCP port ${port} is reachable on ${hostname}. Attempting Oracle connection...`);
    
    // Step 2: Oracle connection
    const { connection: conn, mode } = await getOracleConnection({ hostname, port, serviceName, username, password, useSID });
    connection = conn;
    
    // Quick version query to validate connection
    const result = await connection.execute(
      `SELECT banner FROM v$version WHERE ROWNUM = 1`
    );
    
    const banner = result.rows?.[0]?.[0] || 'Connected';
    
    // Detect if connected to a PDB instead of CDB root
    let isPDB = false;
    let containerName = '';
    try {
      const conResult = await connection.execute(
        `SELECT SYS_CONTEXT('USERENV', 'CON_NAME'), SYS_CONTEXT('USERENV', 'CON_ID') FROM DUAL`
      );
      containerName = String(conResult.rows?.[0]?.[0] || '');
      const conId = Number(conResult.rows?.[0]?.[1] || 0);
      // CON_ID > 2 means we're inside a PDB (0=non-CDB, 1=CDB$ROOT, 2=PDB$SEED, 3+=user PDB)
      isPDB = conId > 2;
    } catch (_) {
      // SYS_CONTEXT not available or non-CDB database — not a PDB
    }
    
    await connection.close();
    connection = null;
    
    res.json({ 
      success: true, 
      message: `${banner} [${mode} mode]`, 
      driverMode: mode,
      isPDB,
      containerName: isPDB ? containerName : undefined,
    });
  } catch (error: any) {
    logger.error('Oracle connection test failed:', error);
    if (connection) {
      try { await connection.close(); } catch (_) { /* ignore */ }
    }
    
    // Provide helpful diagnostics based on error code
    let diagnostic = '';
    const errMsg = error.message || '';
    const currentMode = oracleDriverMode;
    
    if (errMsg.includes('NJS-510') || errMsg.includes('timed out')) {
      if (currentMode === 'thin') {
        diagnostic = 'TCP port is reachable but Oracle protocol handshake timed out. This usually means the Oracle database version is older than 12.1 (e.g. 11g, 10g). The Thin driver only supports 12.1+. Install Oracle Instant Client on this server to enable Thick mode (all versions). Try also using SID instead of Service Name.';
      } else {
        diagnostic = 'TCP port is reachable but Oracle handshake timed out. The listener may be redirecting to a blocked port. Try using SID instead of Service Name.';
      }
    } else if (errMsg.includes('ORA-12514') || errMsg.includes('ORA-12505')) {
      diagnostic = 'The listener is reachable but does not recognize the service name/SID. Check lsnrctl status on the server.';
    } else if (errMsg.includes('ORA-01017')) {
      diagnostic = 'Invalid username/password. The connection itself is working — fix the credentials.';
    } else if (errMsg.includes('ORA-28000')) {
      diagnostic = 'Account is locked. The connection itself is working but the user account needs to be unlocked.';
    } else if (errMsg.includes('DPI-1047') || errMsg.includes('cannot load')) {
      diagnostic = 'Oracle Client library issue. Make sure Oracle Instant Client is properly installed and accessible.';
    }
    
    res.status(400).json({
      success: false,
      message: errMsg || 'Failed to connect to Oracle database',
      diagnostic,
      driverMode: currentMode,
    });
  }
});

// Driver info endpoint — shows detected mode
router.get('/driver-info', async (_req, res) => {
  const mode = await initOracleDriver();
  if (mode === 'unavailable') {
    return res.json({
      driverMode: mode,
      thinSupport: 'Oracle 12.1+',
      thickSupport: 'Oracle 10g+',
      message: 'The oracledb package is not installed. Oracle import features are unavailable. Install it with: npm install oracledb',
    });
  }
  res.json({
    driverMode: mode,
    thinSupport: 'Oracle 12.1+',
    thickSupport: 'Oracle 10g+',
    message: mode === 'thick'
      ? 'Oracle Client libraries detected. All Oracle database versions are supported.'
      : 'No Oracle Client libraries found. Using Thin mode — only Oracle 12.1+ is supported. Install Oracle Instant Client for older versions.',
  });
});

router.post('/environment-conflict', validateRequest(environmentConflictSchema), async (req, res, next) => {
  try {
    const { customerId, environmentName, isRAC } = req.body;
    getUserCustomerAccess(req, customerId);

    const duplicateEnv = await buildDuplicateEnvironmentResponse(customerId, environmentName, isRAC);
    res.json({ duplicateEnv });
  } catch (error) {
    next(error);
  }
});

// Import data from Oracle
router.post('/oracle-data', validateRequest(oracleConnectionSchema), async (req, res, next) => {
  let connection: any = null;
  try {
    const { hostname, port, serviceName, username, password, useSID } = req.body;
    
    const { connection: conn, mode } = await getOracleConnection({ hostname, port, serviceName, username, password, useSID });
    connection = conn;
    
    // Detect if connected to a PDB instead of CDB root
    let isPDB = false;
    let containerName = '';
    try {
      const conResult = await connection.execute(
        `SELECT SYS_CONTEXT('USERENV', 'CON_NAME'), SYS_CONTEXT('USERENV', 'CON_ID') FROM DUAL`
      );
      containerName = String(conResult.rows?.[0]?.[0] || '');
      const conId = Number(conResult.rows?.[0]?.[1] || 0);
      isPDB = conId > 2;
    } catch (_) {
      // Non-CDB database
    }
    
    // 1. Database version & banner (v$version only has BANNER in all versions; VERSION_FULL added in 18c)
    let versionResult: any;
    try {
      versionResult = await connection.execute(
        `SELECT version_full, banner FROM v$version WHERE ROWNUM = 1`
      );
    } catch (_) {
      // Fallback: BANNER exists in all Oracle versions
      versionResult = await connection.execute(
        `SELECT banner, banner FROM v$version WHERE ROWNUM = 1`
      );
    }
    
    // 2. Database name and DB unique name
    let dbInfoResult: any;
    try {
      dbInfoResult = await connection.execute(
        `SELECT name, db_unique_name, platform_name, log_mode FROM v$database`
      );
    } catch (_) {
      // db_unique_name or platform_name may not exist in very old versions
      dbInfoResult = await connection.execute(
        `SELECT name, name, 'Unknown', log_mode FROM v$database`
      );
    }
    
    // 3. Instance info (edition/version_full only in 18c+)
    let instanceResult: any;
    try {
      instanceResult = await connection.execute(
        `SELECT instance_name, host_name, status, edition, version_full FROM v$instance`
      );
    } catch (_) {
      try {
        instanceResult = await connection.execute(
          `SELECT instance_name, host_name, status, 'N/A', version FROM v$instance`
        );
      } catch (__) {
        instanceResult = await connection.execute(
          `SELECT instance_name, host_name, status, 'N/A', 'N/A' FROM v$instance`
        );
      }
    }
    
    // 4. Feature usage statistics (the core data for compliance)
    const featureUsageResult = await connection.execute(
      `SELECT 
         name,
         currently_used,
         detected_usages,
         first_usage_date,
         last_usage_date,
         description,
         version
       FROM dba_feature_usage_statistics
       WHERE version = (SELECT MAX(version) FROM dba_feature_usage_statistics)
       ORDER BY name`
    );
    
    // 5. CPU/core info from the host
    const cpuResult = await connection.execute(
      `SELECT 
         stat_name, 
         value 
       FROM v$osstat 
       WHERE stat_name IN ('NUM_CPUS', 'NUM_CPU_CORES', 'NUM_CPU_SOCKETS', 'PHYSICAL_MEMORY_BYTES')`
    );
    
    // 6. Check if DataGuard is active
    const dgResult = await connection.execute(
      `SELECT database_role, protection_mode, switchover_status FROM v$database`
    );
    
    // 7. Check for RAC
    let isRAC = false;
    try {
      const racResult = await connection.execute(
        `SELECT value FROM v$parameter WHERE name = 'cluster_database'`
      );
      isRAC = racResult.rows?.[0]?.[0]?.toUpperCase() === 'TRUE';
    } catch (_) {
      // Not a RAC or insufficient privileges
    }
    
    // 7b. If RAC, get ALL instances from gv$instance and per-node CPU info
    let racInstances: any[] = [];
    let racCpuByNode: Record<string, Record<string, string>> = {};
    if (isRAC) {
      try {
        const gvResult = await connection.execute(
          `SELECT inst_id, instance_name, host_name, status FROM gv$instance ORDER BY inst_id`
        );
        racInstances = (gvResult.rows || []).map((row: any) => ({
          instId: row[0],
          name: String(row[1]),
          hostName: String(row[2]),
          status: String(row[3]),
        }));
      } catch (_) {
        // gv$ not available, fall back to single instance
      }
      
      // Per-node CPU stats via gv$osstat
      try {
        const gvCpuResult = await connection.execute(
          `SELECT inst_id, stat_name, value FROM gv$osstat 
           WHERE stat_name IN ('NUM_CPUS', 'NUM_CPU_CORES', 'NUM_CPU_SOCKETS', 'PHYSICAL_MEMORY_BYTES')
           ORDER BY inst_id`
        );
        for (const row of (gvCpuResult.rows || [])) {
          const instId = String(row[0]);
          if (!racCpuByNode[instId]) racCpuByNode[instId] = {};
          racCpuByNode[instId][row[1] as string] = String(row[2]);
        }
      } catch (_) {
        // gv$osstat not available
      }
    }
    
    // 8. PDB info (if Multitenant)
    let pdbs: any[] = [];
    try {
      const pdbResult = await connection.execute(
        `SELECT con_id, name, open_mode FROM v$pdbs ORDER BY con_id`
      );
      pdbs = (pdbResult.rows || []).map((row: any) => ({
        conId: row[0],
        name: row[1],
        openMode: row[2],
      }));
    } catch (_) {
      // Not multitenant or insufficient privileges
    }
    
    // 8b. Per-PDB feature usage (which PDB uses which features)
    // CDB_FEATURE_USAGE_STATISTICS has a CON_ID column for PDB-level data
    let pdbFeatures: Record<number, Array<{ name: string; currentlyUsed: boolean }>> = {};
    if (pdbs.length > 0) {
      try {
        const pdbFeatResult = await connection.execute(
          `SELECT 
             con_id,
             name,
             currently_used
           FROM cdb_feature_usage_statistics
           WHERE version = (SELECT MAX(version) FROM cdb_feature_usage_statistics)
             AND currently_used = 'TRUE'
           ORDER BY con_id, name`
        );
        for (const row of (pdbFeatResult.rows || [])) {
          const conId = Number(row[0]);
          if (!pdbFeatures[conId]) pdbFeatures[conId] = [];
          pdbFeatures[conId].push({
            name: String(row[1]),
            currentlyUsed: row[2] === 'TRUE',
          });
        }
        // Enrich PDB data with feature counts
        pdbs = pdbs.map(pdb => ({
          ...pdb,
          features: pdbFeatures[pdb.conId] || [],
          featureCount: (pdbFeatures[pdb.conId] || []).length,
        }));
      } catch (_) {
        // CDB_FEATURE_USAGE_STATISTICS not available (requires CDB root + privileges)
      }
      
      // 8c. Per-PDB session counts (useful for NUP licensing)
      try {
        const pdbSessionResult = await connection.execute(
          `SELECT 
             con_id,
             COUNT(*) AS session_count,
             COUNT(DISTINCT username) AS user_count
           FROM v$session
           WHERE type = 'USER'
             AND con_id > 0
           GROUP BY con_id
           ORDER BY con_id`
        );
        const sessionMap: Record<number, { sessions: number; users: number }> = {};
        for (const row of (pdbSessionResult.rows || [])) {
          sessionMap[Number(row[0])] = {
            sessions: Number(row[1]) || 0,
            users: Number(row[2]) || 0,
          };
        }
        pdbs = pdbs.map(pdb => ({
          ...pdb,
          currentSessions: sessionMap[pdb.conId]?.sessions || 0,
          currentUsers: sessionMap[pdb.conId]?.users || 0,
        }));
      } catch (_) {
        // v$session per-PDB query not available
      }
    }
    
    // 9. Database options
    let dbOptions: any[] = [];
    try {
      const optionsResult = await connection.execute(
        `SELECT parameter, value FROM v$option ORDER BY parameter`
      );
      dbOptions = (optionsResult.rows || []).map((row: any) => ({
        parameter: row[0],
        value: row[1],
      }));
    } catch (_) {
      // Insufficient privileges
    }
    
    // 10. High Water Mark statistics (critical for Oracle LMS audits)
    // Oracle auditors use HWM values — they represent the MAXIMUM ever seen,
    // not just current. If hardware was ever larger, Oracle licenses to the peak.
    let hwmStats: Record<string, { highwater: string; lastValue: string; description: string }> = {};
    try {
      const hwmResult = await connection.execute(
        `SELECT 
           name,
           highwater,
           last_value,
           description
         FROM dba_high_water_mark_statistics
         WHERE name IN (
           'CPU_COUNT',
           'CPU_CORE_COUNT',
           'CPU_SOCKET_COUNT',
           'SESSIONS_HIGHWATER',
           'SESSIONS_MAX',
           'DB_SIZE',
           'USER_COUNT',
           'DATAFILE_COUNT',
           'TABLESPACE_COUNT',
           'SEGMENT_SIZE'
         )
         ORDER BY name`
      );
      for (const row of (hwmResult.rows || [])) {
        hwmStats[row[0] as string] = {
          highwater: String(row[1] ?? ''),
          lastValue: String(row[2] ?? ''),
          description: String(row[3] ?? ''),
        };
      }
    } catch (_) {
      // DBA_HIGH_WATER_MARK_STATISTICS not available or insufficient privileges
      // (requires SELECT_CATALOG_ROLE or DBA role)
    }

    await connection.close();
    connection = null;
    
    // Parse results
    const banner = versionResult.rows?.[0]?.[1] || versionResult.rows?.[0]?.[0] || '';
    // version_full or extract version number from banner (e.g. "Oracle Database 19c Enterprise Edition Release 19.0.0.0.0")
    let version = versionResult.rows?.[0]?.[0] || '';
    if (!version || version === banner) {
      // Extract version from banner: look for patterns like 19.0.0.0.0 or 11.2.0.4.0
      const vMatch = banner.match(/(\d+\.\d+\.\d+[\.\d]*)/);
      version = vMatch ? vMatch[1] : '';
    }
    
    const dbName = dbInfoResult.rows?.[0]?.[0] || '';
    const dbUniqueName = dbInfoResult.rows?.[0]?.[1] || '';
    const platform = dbInfoResult.rows?.[0]?.[2] || '';
    const logMode = dbInfoResult.rows?.[0]?.[3] || '';
    
    const instanceName = instanceResult.rows?.[0]?.[0] || '';
    const instanceHost = instanceResult.rows?.[0]?.[1] || '';
    const instanceStatus = instanceResult.rows?.[0]?.[2] || '';
    const instanceEdition = instanceResult.rows?.[0]?.[3] || '';
    
    // Determine edition from banner/instance
    // Values must match int_DatabaseEdition reference table: 'Enterprise', 'Standard', 'Express'
    let edition = 'Enterprise';
    const bannerLower = (banner + ' ' + instanceEdition).toLowerCase();
    if (bannerLower.includes('standard')) {
      edition = 'Standard';
    } else if (bannerLower.includes('enterprise')) {
      edition = 'Enterprise';
    } else if (bannerLower.includes('express')) {
      edition = 'Express';
    }
    
    // Parse CPU stats
    const cpuStats: Record<string, string> = {};
    for (const row of (cpuResult.rows || [])) {
      cpuStats[row[0] as string] = String(row[1]);
    }
    
    // Parse DataGuard info
    const dbRole = dgResult.rows?.[0]?.[0] || '';
    const isDataGuard = dbRole !== 'PRIMARY';
    
    // Parse features
    const features = (featureUsageResult.rows || []).map((row: any) => ({
      name: row[0],
      currentlyUsed: row[1] === 'TRUE',
      detectedUsages: Number(row[2]) || 0,
      firstUsageDate: row[3] ? new Date(row[3]).toISOString().split('T')[0] : null,
      lastUsageDate: row[4] ? new Date(row[4]).toISOString().split('T')[0] : null,
      description: row[5],
      version: row[6],
    }));
    
    // Determine DB type
    let dbType = 'Non-CDB';
    if (pdbs.length > 0) {
      dbType = 'CDB';
    }
    
    // Determine environment type
    let envType = 'Standalone';
    if (isRAC) {
      envType = 'RAC';
    }
    
    // Extract version number for display
    const versionShort = version.split('.').slice(0, 2).join('.');
    
    const importData = {
      database: {
        name: dbName,
        uniqueName: dbUniqueName,
        version: version,
        versionShort: versionShort,
        banner: banner,
        edition: edition,
        platform: platform,
        logMode: logMode,
        dbType: dbType,
        envType: envType,
        isRAC: isRAC,
        isDataGuard: isDataGuard,
        databaseRole: dbRole,
        isPDB: isPDB,
        containerName: isPDB ? containerName : undefined,
      },
      // Build instances array: use gv$instance data for RAC, fallback to v$instance single row
      // localInstanceName: identifies which instance is running on the host we connected to
      localInstanceName: instanceName,
      localInstanceHost: instanceHost,
      instances: racInstances.length > 0
        ? racInstances.map(ri => ({
            name: ri.name,
            hostName: ri.hostName,
            status: ri.status,
            cpu: racCpuByNode[String(ri.instId)] ? {
              numCpus: racCpuByNode[String(ri.instId)]['NUM_CPUS'] || '0',
              numCores: racCpuByNode[String(ri.instId)]['NUM_CPU_CORES'] || '0',
              numSockets: racCpuByNode[String(ri.instId)]['NUM_CPU_SOCKETS'] || '0',
              physicalMemory: racCpuByNode[String(ri.instId)]['PHYSICAL_MEMORY_BYTES'] || '0',
            } : undefined,
          }))
        : [{
            name: instanceName,
            hostName: instanceHost,
            status: instanceStatus,
            cpu: undefined,
          }],
      cpu: {
        numCpus: cpuStats['NUM_CPUS'] || '0',
        numCores: cpuStats['NUM_CPU_CORES'] || '0',
        numSockets: cpuStats['NUM_CPU_SOCKETS'] || '0',
        physicalMemory: cpuStats['PHYSICAL_MEMORY_BYTES'] || '0',
      },
      // High Water Mark: maximum values ever seen (what Oracle LMS auditors use)
      highWaterMark: Object.keys(hwmStats).length > 0 ? {
        cpuCount: hwmStats['CPU_COUNT']?.highwater || null,
        cpuCoreCount: hwmStats['CPU_CORE_COUNT']?.highwater || null,
        cpuSocketCount: hwmStats['CPU_SOCKET_COUNT']?.highwater || null,
        sessionsHighwater: hwmStats['SESSIONS_HIGHWATER']?.highwater || null,
        sessionsMax: hwmStats['SESSIONS_MAX']?.highwater || null,
        userCount: hwmStats['USER_COUNT']?.highwater || null,
        dbSize: hwmStats['DB_SIZE']?.highwater || null,
        // Include current values for comparison
        current: {
          cpuCount: hwmStats['CPU_COUNT']?.lastValue || null,
          cpuCoreCount: hwmStats['CPU_CORE_COUNT']?.lastValue || null,
          cpuSocketCount: hwmStats['CPU_SOCKET_COUNT']?.lastValue || null,
          sessionsHighwater: hwmStats['SESSIONS_HIGHWATER']?.lastValue || null,
          userCount: hwmStats['USER_COUNT']?.lastValue || null,
        }
      } : null,
      features: features,
      pdbs: pdbs,
      dbOptions: dbOptions,
    };
    
    logger.info(`Oracle import completed: ${dbName} (${edition}) - ${features.length} features retrieved`);
    
    res.json(importData);
  } catch (error: any) {
    logger.error('Oracle data import failed:', error);
    if (connection) {
      try { await connection.close(); } catch (_) { /* ignore */ }
    }
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Failed to import data from Oracle database' 
    });
  }
});

router.post('/save-environment', validateRequest(saveOracleImportSchema), async (req, res, next) => {
  try {
    const { customerId, hostname, port, serviceName, primaryUse, hostAssignments, importData } = req.body;
    getUserCustomerAccess(req, customerId);

    const environmentName = getEnvironmentNameFromImport(importData);
    const duplicateEnv = await buildDuplicateEnvironmentResponse(customerId, environmentName, importData.database.isRAC === true);
    const displayInstances = getDisplayInstances(importData);

    if (displayInstances.length === 0) {
      return res.status(400).json({ error: 'No instances were imported to save' });
    }

    if (duplicateEnv && !importData.database.isRAC) {
      return res.status(409).json({
        error: `An environment named "${environmentName}" already exists for this customer. Rename or delete the existing one first.`,
        duplicateEnv,
      });
    }

    const existingInstanceNames = new Set((duplicateEnv?.existingInstances || []).map((name) => name.toLowerCase()));
    const instancesToPersist = duplicateEnv && importData.database.isRAC
      ? displayInstances.filter((instance) => !existingInstanceNames.has(instance.name.toLowerCase()))
      : displayInstances;

    const unassignedInstances = instancesToPersist.filter((instance) => !hostAssignments[instance.name]);
    if (unassignedInstances.length > 0) {
      return res.status(400).json({
        error: `Please assign a host to all instances: ${unassignedInstances.map((instance) => instance.name).join(', ')}`,
      });
    }

    const assignedHostIds = [...new Set(instancesToPersist.map((instance) => hostAssignments[instance.name]))];
    const availableHosts = assignedHostIds.length > 0
      ? await db
          .select()
          .from(hosts)
          .where(and(eq(hosts.customerId, customerId), inArray(hosts.id, assignedHostIds)))
          .execute()
      : [];

    const hostMap = new Map(availableHosts.map((host) => [host.id, host]));
    const invalidAssignments = assignedHostIds.filter((hostId) => !hostMap.has(hostId));

    if (invalidAssignments.length > 0) {
      return res.status(400).json({ error: 'One or more assigned hosts do not belong to the selected customer' });
    }

    const coreErrors: string[] = [];
    for (const instance of instancesToPersist) {
      const assignedHost = hostMap.get(hostAssignments[instance.name]);
      if (!assignedHost) {
        continue;
      }

      const currentCores = Number.parseInt(instance.cpu?.numCores || importData.cpu?.numCores || '0', 10) || 0;
      const hwmCores = Number.parseInt(importData.highWaterMark?.cpuCoreCount || '0', 10) || 0;
      const detectedCores = Math.max(currentCores, hwmCores);
      const hostCores = assignedHost.cores || 0;

      if (detectedCores > 0 && hostCores > 0 && hostCores < detectedCores) {
        const source = hwmCores > currentCores ? ' (from High Water Mark)' : '';
        coreErrors.push(
          `Host "${assignedHost.name}" has ${hostCores} cores but Oracle reports ${detectedCores} cores${source}. The host must have at least as many cores as the peak value.`,
        );
      }
    }

    if (coreErrors.length > 0) {
      return res.status(400).json({ error: coreErrors[0], coreErrors });
    }

    const result = await withTransaction(async (tx) => {
      const currentDuplicate = await tx
        .select()
        .from(environments)
        .where(
          and(
            eq(environments.customerId, customerId),
            sql`lower(${environments.name}) = lower(${environmentName})`,
          ),
        )
        .limit(1)
        .execute();

      const duplicateEnvironment = currentDuplicate[0];
      const versionLabel = getVersionLabel(importData);
      const environmentDescription = `Imported from ${hostname}:${port}/${serviceName} - ${importData.database.banner || 'Oracle'}`;

      if (duplicateEnvironment && importData.database.isRAC) {
        const currentInstances = await tx
          .select()
          .from(instances)
          .where(eq(instances.environmentId, duplicateEnvironment.id))
          .execute();

        const currentInstanceNames = new Set(currentInstances.map((instance: any) => instance.name.toLowerCase()));
        const newInstances = displayInstances.filter((instance) => !currentInstanceNames.has(instance.name.toLowerCase()));

        for (const instance of newInstances) {
          await tx
            .insert(instances)
            .values({
              id: uuidv4(),
              environmentId: duplicateEnvironment.id,
              name: instance.name,
              hostId: hostAssignments[instance.name],
              isPrimary: false,
              status: instance.status || 'Running',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            .execute();
        }

        await tx
          .update(environments)
          .set({
            description: duplicateEnvironment.description || environmentDescription,
            primaryUse,
            edition: importData.database.edition || duplicateEnvironment.edition || '',
            version: versionLabel,
            type: importData.database.envType || duplicateEnvironment.type || '',
            dbType: importData.database.dbType || duplicateEnvironment.dbType || '',
            isDataGuard: importData.database.isDataGuard || false,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(environments.id, duplicateEnvironment.id))
          .execute();

        await upsertImportedFeatureStats(tx, duplicateEnvironment.id, importData.features);
        await upsertImportedPdbs(tx, duplicateEnvironment.id, importData.pdbs);

        const mergedInstances = await tx
          .select({ name: instances.name })
          .from(instances)
          .where(eq(instances.environmentId, duplicateEnvironment.id))
          .execute();

        return {
          mode: newInstances.length > 0 ? 'merged' : 'unchanged',
          environmentId: duplicateEnvironment.id,
          environmentName: duplicateEnvironment.name,
          featureCount: importData.features.length,
          instanceCount: mergedInstances.length,
          addedInstanceCount: newInstances.length,
          duplicateEnv: {
            id: duplicateEnvironment.id,
            name: duplicateEnvironment.name,
            isRAC: true,
            existingInstances: mergedInstances.map((instance) => instance.name),
          },
        };
      }

      const environmentId = uuidv4();
      await tx
        .insert(environments)
        .values({
          id: environmentId,
          name: environmentName,
          description: environmentDescription,
          customerId,
          status: 'active',
          type: importData.database.envType || '',
          version: versionLabel,
          edition: importData.database.edition || '',
          primaryUse,
          dbType: importData.database.dbType || '',
          isDataGuard: importData.database.isDataGuard || false,
          licensable: true,
          options: JSON.stringify([]),
          managementPacks: JSON.stringify([]),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .execute();

      for (const [index, instance] of displayInstances.entries()) {
        await tx
          .insert(instances)
          .values({
            id: uuidv4(),
            environmentId,
            name: instance.name,
            hostId: hostAssignments[instance.name],
            isPrimary: index === 0,
            status: instance.status || 'Running',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .execute();
      }

      await upsertImportedFeatureStats(tx, environmentId, importData.features);
      await upsertImportedPdbs(tx, environmentId, importData.pdbs);

      return {
        mode: 'created',
        environmentId,
        environmentName,
        featureCount: importData.features.length,
        instanceCount: displayInstances.length,
        addedInstanceCount: displayInstances.length,
        duplicateEnv: {
          id: environmentId,
          name: environmentName,
          isRAC: importData.database.isRAC === true,
          existingInstances: displayInstances.map((instance) => instance.name),
        },
      };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;

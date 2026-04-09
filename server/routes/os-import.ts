import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middlewares/validationMiddleware';
import logger from '../utils/logger';
import db from '../database';
import { withTransaction } from '../utils/error-handler';
import { environments, featureStats, hosts, instances, pdbs } from '../../shared/schema';
import * as net from 'net';
import { Client as SSHClient } from 'ssh2';
import * as http from 'http';
import { and, eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { calculateCoreFactor, ensureCoreAssignments, normalizeServerType, validateVirtualHostCores, validateVirtualizationTypeConsistency } from './hosts';

const router = Router();

// ─── Schemas ─────────────────────────────────────────────────────────────────

const sshConnectionSchema = z.object({
  body: z.object({
    hostname: z.string().min(1, 'Hostname is required'),
    port: z.number().int().min(1).max(65535).default(22),
    username: z.string().min(1, 'Username is required'),
    password: z.string().default(''),
    osType: z.enum(['linux', 'windows', 'sunos', 'hp-ux', 'kvm-host', 'vmware-host']),
    // WinRM config (only for windows)
    winrmPort: z.number().int().min(1).max(65535).default(5985),
    useHttps: z.boolean().default(false),
    // SSH private key auth (optional, for non-windows)
    privateKey: z.string().optional(),
    passphrase: z.string().optional(),
  }).refine(data => {
    // Windows requires password; SSH types accept password OR privateKey
    if (data.osType === 'windows') return !!data.password;
    return !!data.password || !!data.privateKey;
  }, { message: 'Password or private key is required' }),
});

const hostConflictSchema = z.object({
  body: z.object({
    customerId: z.string().min(1, 'Customer ID is required'),
    hostName: z.string().min(1, 'Host name is required'),
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
  localInstanceHost: z.string().optional(),
  instances: z.array(importedInstanceSchema).default([]),
  features: z.array(importedFeatureSchema).default([]),
  pdbs: z.array(importedPdbSchema).default([]),
}).passthrough();

const saveOsImportSchema = z.object({
  body: z.object({
    customerId: z.string().min(1, 'Customer ID is required'),
    primaryUse: z.string().min(1, 'Primary use is required'),
    discoveryHostname: z.string().optional(),
    host: z.object({
      name: z.string().min(1, 'Host name is required'),
      cpuModel: z.string().min(1, 'CPU model is required'),
      serverType: z.enum(['Physical', 'Virtual', 'Oracle Cloud']),
      virtualizationType: z.string().optional(),
      sockets: z.number().int().min(1, 'Sockets are required'),
      cores: z.number().int().min(1, 'Cores are required'),
      threadsPerCore: z.number().int().min(1, 'Threads per core are required'),
      coreFactor: z.number().optional(),
      hasHardPartitioning: z.boolean().optional().default(false),
      physicalHostId: z.string().optional(),
    }),
    connectedInstances: z.array(
      z.object({
        instanceName: z.string().min(1, 'Instance name is required'),
        importData: importedOracleDataSchema,
      }),
    ).default([]),
  }),
});

type ImportedOracleData = z.infer<typeof importedOracleDataSchema>;

function getUserCustomerAccess(req: any, customerId: string) {
  const user = req.user as { id: string; role: 'admin' | 'customer'; customerId?: string } | undefined;
  const userIsAdmin = user?.role === 'admin';
  const userCustomerId = user?.role === 'customer' ? user.id : user?.customerId;

  if (!userIsAdmin && customerId !== userCustomerId) {
    const error: any = new Error('Unauthorized access to this customer import flow');
    error.status = 403;
    throw error;
  }
}

function getEnvironmentNameFromImport(importData: ImportedOracleData, fallbackInstanceName: string) {
  return (
    importData.database.name?.trim() ||
    importData.database.uniqueName?.trim() ||
    fallbackInstanceName ||
    'Imported Oracle Environment'
  );
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

function isRemoteInstance(localInstanceHost: string | undefined, discoveryHostname: string | undefined) {
  const instanceHost = (localInstanceHost || '').toLowerCase();
  const currentHost = (discoveryHostname || '').toLowerCase();

  if (!instanceHost || !currentHost) {
    return false;
  }

  return instanceHost !== currentHost
    && !currentHost.startsWith(instanceHost.split('.')[0] + '.')
    && !instanceHost.startsWith(currentHost.split('.')[0] + '.')
    && instanceHost.split('.')[0] !== currentHost.split('.')[0];
}

async function findDuplicateHost(customerId: string, hostName: string, tx: typeof db | any = db) {
  const matches = await tx
    .select({ id: hosts.id, name: hosts.name })
    .from(hosts)
    .where(
      and(
        eq(hosts.customerId, customerId),
        sql`lower(${hosts.name}) = lower(${hostName})`,
      ),
    )
    .limit(1)
    .execute();

  return matches[0] ?? null;
}

async function findDuplicateEnvironment(customerId: string, environmentName: string, tx: typeof db | any = db) {
  const matches = await tx
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

  return matches[0] ?? null;
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

// ─── SSH helper ──────────────────────────────────────────────────────────────

function sshExec(conn: InstanceType<typeof SSHClient>, command: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Command timed out: ${command}`)), timeoutMs);
    conn.exec(command, (err, stream) => {
      if (err) { clearTimeout(timer); return reject(err); }
      let stdout = '';
      let stderr = '';
      stream.on('data', (data: Buffer) => { stdout += data.toString(); });
      stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      stream.on('close', () => {
        clearTimeout(timer);
        resolve(stdout.trim());
      });
    });
  });
}

// ─── WinRM helper (Basic auth over HTTP/HTTPS) ──────────────────────────────

function winrmExec(
  config: { hostname: string; port: number; username: string; password: string; useHttps: boolean },
  command: string,
  timeoutMs = 20000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`WinRM command timed out: ${command}`)), timeoutMs);

    // Build SOAP envelope for WinRM command execution
    const shellId = createShellRequest(command);
    const authHeader = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
    const protocol = config.useHttps ? 'https' : 'http';
    const url = `${protocol}://${config.hostname}:${config.port}/wsman`;

    // Step 1: Create shell
    const createShellBody = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:wsman="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd">
  <s:Header>
    <wsa:To>${url}</wsa:To>
    <wsman:ResourceURI s:mustUnderstand="true">http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd</wsman:ResourceURI>
    <wsa:ReplyTo><wsa:Address s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address></wsa:ReplyTo>
    <wsa:Action s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/09/transfer/Create</wsa:Action>
    <wsman:MaxEnvelopeSize s:mustUnderstand="true">153600</wsman:MaxEnvelopeSize>
    <wsman:OperationTimeout>PT60S</wsman:OperationTimeout>
  </s:Header>
  <s:Body>
    <rsp:Shell xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell">
      <rsp:InputStreams>stdin</rsp:InputStreams>
      <rsp:OutputStreams>stdout stderr</rsp:OutputStreams>
    </rsp:Shell>
  </s:Body>
</s:Envelope>`;

    // Use a simpler approach: build a PowerShell command via single SOAP call
    // Instead of full WinRM protocol, use a single-shot command execution
    const psCommand = Buffer.from(command, 'utf16le').toString('base64');
    
    // Combined create+execute SOAP for simplicity
    const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:wsman="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"
  xmlns:wsen="http://schemas.xmlsoap.org/ws/2004/09/enumeration"
  xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell">
  <s:Header>
    <wsa:To>${url}</wsa:To>
    <wsman:ResourceURI s:mustUnderstand="true">http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd</wsman:ResourceURI>
    <wsa:ReplyTo><wsa:Address s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address></wsa:ReplyTo>
    <wsa:Action s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/09/transfer/Create</wsa:Action>
    <wsman:MaxEnvelopeSize s:mustUnderstand="true">153600</wsman:MaxEnvelopeSize>
    <wsman:OperationTimeout>PT60S</wsman:OperationTimeout>
  </s:Header>
  <s:Body>
    <rsp:Shell>
      <rsp:InputStreams>stdin</rsp:InputStreams>
      <rsp:OutputStreams>stdout stderr</rsp:OutputStreams>
    </rsp:Shell>
  </s:Body>
</s:Envelope>`;

    const reqOpts: http.RequestOptions = {
      hostname: config.hostname,
      port: config.port,
      path: '/wsman',
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml;charset=UTF-8',
        'Authorization': authHeader,
        'Content-Length': Buffer.byteLength(soapBody),
      },
      timeout: timeoutMs,
    };

    const req = http.request(reqOpts, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        clearTimeout(timer);
        if (res.statusCode === 401) {
          return reject(new Error('WinRM authentication failed. Check username/password and ensure WinRM Basic auth is enabled.'));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`WinRM returned HTTP ${res.statusCode}: ${body.substring(0, 500)}`));
        }
        // Extract ShellId from response
        const shellMatch = body.match(/<rsp:ShellId>([^<]+)<\/rsp:ShellId>/);
        if (shellMatch) {
          // Now execute command in the shell
          executeInShell(config, authHeader, url, shellMatch[1], command, timeoutMs)
            .then(resolve)
            .catch(reject);
        } else {
          reject(new Error('Failed to create WinRM shell: ' + body.substring(0, 500)));
        }
      });
    });
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.on('timeout', () => { clearTimeout(timer); req.destroy(); reject(new Error('WinRM connection timed out')); });
    req.write(soapBody);
    req.end();
  });
}

function executeInShell(
  config: { hostname: string; port: number; useHttps: boolean },
  authHeader: string,
  url: string,
  shellId: string,
  command: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const commandId = 'cmd-' + Date.now();
    const soapExec = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:wsman="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"
  xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell">
  <s:Header>
    <wsa:To>${url}</wsa:To>
    <wsman:ResourceURI s:mustUnderstand="true">http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd</wsman:ResourceURI>
    <wsa:ReplyTo><wsa:Address s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address></wsa:ReplyTo>
    <wsa:Action s:mustUnderstand="true">http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Command</wsa:Action>
    <wsman:SelectorSet><wsman:Selector Name="ShellId">${shellId}</wsman:Selector></wsman:SelectorSet>
    <wsman:MaxEnvelopeSize s:mustUnderstand="true">153600</wsman:MaxEnvelopeSize>
    <wsman:OperationTimeout>PT60S</wsman:OperationTimeout>
  </s:Header>
  <s:Body>
    <rsp:CommandLine><rsp:Command>powershell.exe</rsp:Command><rsp:Arguments>-NoProfile -NonInteractive -Command "${escapeXml(command)}"</rsp:Arguments></rsp:CommandLine>
  </s:Body>
</s:Envelope>`;

    const reqOpts: http.RequestOptions = {
      hostname: config.hostname,
      port: config.port,
      path: '/wsman',
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml;charset=UTF-8',
        'Authorization': authHeader,
        'Content-Length': Buffer.byteLength(soapExec),
      },
      timeout: timeoutMs,
    };

    const req = http.request(reqOpts, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`WinRM command execution failed: HTTP ${res.statusCode}`));
        }
        // Extract CommandId
        const cmdMatch = body.match(/<rsp:CommandId>([^<]+)<\/rsp:CommandId>/);
        if (cmdMatch) {
          // Get output
          getCommandOutput(config, authHeader, url, shellId, cmdMatch[1], timeoutMs)
            .then((output) => {
              // Clean up: delete shell (fire-and-forget)
              deleteShell(config, authHeader, url, shellId).catch(() => {});
              resolve(output);
            })
            .catch(reject);
        } else {
          reject(new Error('Failed to execute WinRM command'));
        }
      });
    });
    req.on('error', reject);
    req.write(soapExec);
    req.end();
  });
}

function getCommandOutput(
  config: { hostname: string; port: number; useHttps: boolean },
  authHeader: string,
  url: string,
  shellId: string,
  commandId: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const soapReceive = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:wsman="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"
  xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell">
  <s:Header>
    <wsa:To>${url}</wsa:To>
    <wsman:ResourceURI s:mustUnderstand="true">http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd</wsman:ResourceURI>
    <wsa:ReplyTo><wsa:Address s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address></wsa:ReplyTo>
    <wsa:Action s:mustUnderstand="true">http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Receive</wsa:Action>
    <wsman:SelectorSet><wsman:Selector Name="ShellId">${shellId}</wsman:Selector></wsman:SelectorSet>
    <wsman:MaxEnvelopeSize s:mustUnderstand="true">153600</wsman:MaxEnvelopeSize>
    <wsman:OperationTimeout>PT60S</wsman:OperationTimeout>
  </s:Header>
  <s:Body>
    <rsp:Receive><rsp:DesiredStream CommandId="${commandId}">stdout stderr</rsp:DesiredStream></rsp:Receive>
  </s:Body>
</s:Envelope>`;

    const reqOpts: http.RequestOptions = {
      hostname: config.hostname,
      port: config.port,
      path: '/wsman',
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml;charset=UTF-8',
        'Authorization': authHeader,
        'Content-Length': Buffer.byteLength(soapReceive),
      },
      timeout: timeoutMs,
    };

    const req = http.request(reqOpts, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        // Extract stdout from base64-encoded Stream elements
        const streamMatches = body.match(/<rsp:Stream[^>]*Name="stdout"[^>]*>([^<]*)<\/rsp:Stream>/g) || [];
        let output = '';
        for (const match of streamMatches) {
          const b64Match = match.match(/>([^<]+)</);
          if (b64Match) {
            output += Buffer.from(b64Match[1], 'base64').toString('utf8');
          }
        }
        resolve(output.trim());
      });
    });
    req.on('error', reject);
    req.write(soapReceive);
    req.end();
  });
}

function deleteShell(
  config: { hostname: string; port: number; useHttps: boolean },
  authHeader: string,
  url: string,
  shellId: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const soapDelete = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:wsman="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd">
  <s:Header>
    <wsa:To>${url}</wsa:To>
    <wsman:ResourceURI s:mustUnderstand="true">http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd</wsman:ResourceURI>
    <wsa:ReplyTo><wsa:Address s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address></wsa:ReplyTo>
    <wsa:Action s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/09/transfer/Delete</wsa:Action>
    <wsman:SelectorSet><wsman:Selector Name="ShellId">${shellId}</wsman:Selector></wsman:SelectorSet>
  </s:Header>
  <s:Body/>
</s:Envelope>`;

    const reqOpts: http.RequestOptions = {
      hostname: config.hostname,
      port: config.port,
      path: '/wsman',
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml;charset=UTF-8',
        'Authorization': authHeader,
        'Content-Length': Buffer.byteLength(soapDelete),
      },
    };
    const req = http.request(reqOpts, () => resolve());
    req.on('error', () => resolve()); // Ignore cleanup errors
    req.write(soapDelete);
    req.end();
  });
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function createShellRequest(_command: string): string {
  return ''; // Placeholder — actual CreateShell is built inline
}

// ─── TCP port check ──────────────────────────────────────────────────────────

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

// ─── Linux discovery commands ────────────────────────────────────────────────

async function discoverLinux(conn: InstanceType<typeof SSHClient>): Promise<any> {
  // Hostname
  const hostname = await sshExec(conn, 'hostname -f 2>/dev/null || hostname');
  
  // CPU info via lscpu (available on virtually all modern Linux)
  const lscpu = await sshExec(conn, 'lscpu 2>/dev/null');
  const cpuInfo = parseLscpu(lscpu);
  
  // Detect virtualization
  let virtualizationType = '';
  let serverType: 'Physical' | 'Virtual' | 'Oracle Cloud' = 'Physical';
  
  // Method 1: systemd-detect-virt (best on systemd systems)
  const detectVirt = await sshExec(conn, 'systemd-detect-virt 2>/dev/null');
  if (detectVirt && detectVirt !== 'none' && !detectVirt.includes('not found')) {
    serverType = 'Virtual';
    virtualizationType = mapVirtualizationType(detectVirt);
  }
  
  // Method 2: DMI product name
  if (serverType === 'Physical') {
    const productName = await sshExec(conn, 'cat /sys/class/dmi/id/product_name 2>/dev/null');
    const virtFromProduct = detectVirtFromProductName(productName);
    if (virtFromProduct) {
      serverType = 'Virtual';
      virtualizationType = virtFromProduct;
    }
  }
  
  // Method 3: Check hypervisor flag in /proc/cpuinfo
  if (serverType === 'Physical') {
    const cpuFlags = await sshExec(conn, "grep -c hypervisor /proc/cpuinfo 2>/dev/null");
    if (parseInt(cpuFlags) > 0) {
      serverType = 'Virtual';
      virtualizationType = virtualizationType || 'Unknown Hypervisor';
    }
  }

  // Method 4: Detect Oracle Cloud Infrastructure (OCI)
  // OCI instances have "OracleCloud" in chassis_asset_tag
  const chassisAssetTag = await sshExec(conn, 'cat /sys/class/dmi/id/chassis_asset_tag 2>/dev/null');
  if (chassisAssetTag && chassisAssetTag.toLowerCase().includes('oraclecloud')) {
    serverType = 'Oracle Cloud';
    virtualizationType = 'OCI';
  }

  // Detect Oracle installations
  const oracleHomes = await detectOracleHomesLinux(conn);
  
  // Detect listener ports (read-only: parse listener.ora or lsnrctl status output)
  const listenerInfo = await detectListenerInfoLinux(conn, oracleHomes);
  
  // Build flat instances list with default connection info
  const oracleInstances = buildInstanceList(oracleHomes, listenerInfo, hostname);
  
  return {
    hostname,
    osType: 'Linux',
    cpuModel: cpuInfo.modelName,
    sockets: cpuInfo.sockets,
    cores: cpuInfo.totalCores,
    coresPerSocket: cpuInfo.coresPerSocket,
    threadsPerCore: cpuInfo.threadsPerCore,
    serverType,
    virtualizationType,
    hasHardPartitioning: false,
    oracleHomes,
    oracleInstances,
  };
}

function parseLscpu(lscpu: string): {
  modelName: string; sockets: number; coresPerSocket: number;
  totalCores: number; threadsPerCore: number;
} {
  const get = (key: string): string => {
    const match = lscpu.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return match ? match[1].trim() : '';
  };
  
  const sockets = parseInt(get('Socket\\(s\\)')) || 1;
  const coresPerSocket = parseInt(get('Core\\(s\\) per socket')) || 1;
  const threadsPerCore = parseInt(get('Thread\\(s\\) per core')) || 1;
  const totalCores = sockets * coresPerSocket;
  const modelName = get('Model name') || get('CPU') || 'Unknown CPU';
  
  return { modelName, sockets, coresPerSocket, totalCores, threadsPerCore };
}

function mapVirtualizationType(detectVirt: string): string {
  const map: Record<string, string> = {
    'vmware': 'VMware',
    'kvm': 'KVM',
    'oracle': 'OVM (Oracle VM)',
    'xen': 'Xen',
    'microsoft': 'Hyper-V',
    'hyperv': 'Hyper-V',
    'qemu': 'KVM',
    'lxc': 'LXC Container',
    'docker': 'Docker Container',
    'podman': 'Podman Container',
    'openvz': 'OpenVZ',
    'parallels': 'Parallels',
    'bhyve': 'bhyve',
    'zvm': 'IBM z/VM',
    'powervm': 'IBM PowerVM (LPAR)',
    'lpar': 'IBM PowerVM (LPAR)',
    'solaris-zones': 'Solaris Zones',
  };
  const lower = detectVirt.toLowerCase().trim();
  return map[lower] || detectVirt;
}

function detectVirtFromProductName(productName: string): string | null {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  if (lower.includes('vmware')) return 'VMware';
  if (lower.includes('virtualbox')) return 'VirtualBox';
  if (lower.includes('kvm') || lower.includes('qemu')) return 'KVM';
  if (lower.includes('hyper-v') || lower.includes('virtual machine')) return 'Hyper-V';
  if (lower.includes('xen')) return 'Xen';
  if (lower.includes('ovm')) return 'OVM (Oracle VM)';
  if (lower.includes('bochs')) return 'KVM';
  return null;
}

function parseOsRelease(osInfo: string): string {
  // Try PRETTY_NAME from os-release
  const pretty = osInfo.match(/PRETTY_NAME="?([^"\n]+)"?/);
  if (pretty) return pretty[1];
  // Try first line (redhat-release style)
  const firstLine = osInfo.split('\n')[0].trim();
  return firstLine || 'Unknown Linux';
}

async function detectOracleHomesLinux(conn: InstanceType<typeof SSHClient>): Promise<Array<{ path: string; version: string; instances: string[] }>> {
  const homes: Array<{ path: string; version: string; instances: string[] }> = [];
  
  // Method 1: /etc/oratab
  const oratab = await sshExec(conn, 'cat /etc/oratab 2>/dev/null');
  if (oratab) {
    const lines = oratab.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    for (const line of lines) {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const instanceName = parts[0].trim();
        const oracleHome = parts[1].trim();
        const existing = homes.find(h => h.path === oracleHome);
        if (existing) {
          if (!existing.instances.includes(instanceName)) existing.instances.push(instanceName);
        } else {
          // Try to get version
          const version = await sshExec(conn, `${oracleHome}/bin/sqlplus -V 2>/dev/null | head -1`);
          const verMatch = version.match(/(\d+\.\d+[\.\d]*)/);
          homes.push({
            path: oracleHome,
            version: verMatch ? verMatch[1] : 'Unknown',
            instances: [instanceName],
          });
        }
      }
    }
  }
  
  // Method 2: /etc/oraInst.loc → inventory.xml
  if (homes.length === 0) {
    const oraInst = await sshExec(conn, 'cat /etc/oraInst.loc 2>/dev/null');
    const invMatch = oraInst.match(/inventory_loc=(.+)/);
    if (invMatch) {
      const invXml = await sshExec(conn, `cat "${invMatch[1].trim()}/ContentsXML/inventory.xml" 2>/dev/null`);
      const homeMatches = Array.from(invXml.matchAll(/HOME NAME="([^"]*)"[^>]*LOC="([^"]*)"/g));
      for (const m of homeMatches) {
        homes.push({ path: m[2], version: 'Unknown', instances: [] });
      }
    }
  }
  
  // Method 3: Find running pmon processes
  const pmon = await sshExec(conn, 'ps -ef 2>/dev/null | grep pmon | grep -v grep');
  if (pmon) {
    const pmonLines = pmon.split('\n').filter(l => l.includes('pmon'));
    for (const line of pmonLines) {
      const match = line.match(/ora_pmon_(\S+)/);
      if (match) {
        const instName = match[1];
        const found = homes.some(h => h.instances.includes(instName));
        if (!found && homes.length > 0) {
          homes[0].instances.push(instName);
        } else if (!found) {
          homes.push({ path: 'Unknown', version: 'Unknown', instances: [instName] });
        }
      }
    }
  }
  
  return homes;
}

// ─── Listener / Service Name detection (read-only) ───────────────────────────

async function detectListenerInfoLinux(
  conn: InstanceType<typeof SSHClient>,
  oracleHomes: Array<{ path: string; version: string; instances: string[] }>
): Promise<{ port: number; services: string[] }> {
  let port = 1521;
  let services: string[] = [];
  
  // Method 1: Parse listener.ora files (read-only)
  for (const home of oracleHomes) {
    const listenerOra = await sshExec(conn, `cat "${home.path}/network/admin/listener.ora" 2>/dev/null`);
    if (listenerOra) {
      // Extract PORT from listener.ora
      const portMatch = listenerOra.match(/PORT\s*=\s*(\d+)/i);
      if (portMatch) port = parseInt(portMatch[1]) || 1521;
      break;
    }
  }
  
  // Method 2: Check /etc/oratab for instance names as service names
  const oratab = await sshExec(conn, 'cat /etc/oratab 2>/dev/null');
  if (oratab) {
    const lines = oratab.split('\\n').filter(l => l.trim() && !l.startsWith('#'));
    for (const line of lines) {
      const parts = line.split(':');
      if (parts.length >= 2 && parts[0].trim()) {
        services.push(parts[0].trim());
      }
    }
  }
  
  // Method 3: Check for listening processes as fallback for port
  if (port === 1521) {
    const netstat = await sshExec(conn, "ss -tlnp 2>/dev/null | grep -E ':1521|tnslsnr' || netstat -tlnp 2>/dev/null | grep -E ':1521|tnslsnr'");
    if (netstat) {
      const portFromSs = netstat.match(/:(\d{4,5})\s/);
      if (portFromSs) port = parseInt(portFromSs[1]) || 1521;
    }
  }
  
  return { port, services };
}

function buildInstanceList(
  oracleHomes: Array<{ path: string; version: string; instances: string[] }>,
  listenerInfo: { port: number; services: string[] },
  serverHostname: string
): Array<{ name: string; oracleHome: string; version: string; defaultPort: number; defaultServiceName: string; detectedHost: string }> {
  const instances: Array<{ name: string; oracleHome: string; version: string; defaultPort: number; defaultServiceName: string; detectedHost: string }> = [];
  const seen = new Set<string>();
  
  for (const home of oracleHomes) {
    for (const inst of home.instances) {
      // Skip ASM instances (names starting with +)
      if (inst.startsWith('+')) continue;
      if (seen.has(inst)) continue;
      seen.add(inst);
      instances.push({
        name: inst,
        oracleHome: home.path,
        version: home.version,
        defaultPort: listenerInfo.port,
        defaultServiceName: inst, // Instance name is usually also the service name
        detectedHost: serverHostname,
      });
    }
  }
  
  return instances;
}

// ─── SunOS discovery commands ────────────────────────────────────────────────

async function discoverSunOS(conn: InstanceType<typeof SSHClient>): Promise<any> {
  const hostname = await sshExec(conn, 'hostname');
  
  // CPU info via psrinfo and prtconf
  const psrinfoCount = await sshExec(conn, 'psrinfo -p 2>/dev/null || echo 1');
  const sockets = parseInt(psrinfoCount) || 1;
  
  const psrinfoVerbose = await sshExec(conn, 'psrinfo -pv 2>/dev/null');
  const coreMatch = psrinfoVerbose.match(/has (\d+) virtual/);
  const totalLogical = coreMatch ? parseInt(coreMatch[1]) * sockets : sockets;
  
  // kstat for detailed CPU info
  const kstatCpu = await sshExec(conn, 'kstat -m cpu_info -s brand 2>/dev/null | head -5');
  const brandMatch = kstatCpu.match(/brand\s+(.+)/);
  const cpuModel = brandMatch ? brandMatch[1].trim() : 'Unknown SPARC/x86';
  
  const coresPerSocket = await sshExec(conn, 'kstat -m cpu_info -s ncore_per_chip 2>/dev/null | head -3');
  const cpsMatch = coresPerSocket.match(/ncore_per_chip\s+(\d+)/);
  const cps = cpsMatch ? parseInt(cpsMatch[1]) : 1;
  const totalCores = sockets * cps;
  
  // Detect virtualization (Solaris Zones / LDOMs)
  let serverType: 'Physical' | 'Virtual' = 'Physical';
  let virtualizationType = '';
  
  const zoneName = await sshExec(conn, 'zonename 2>/dev/null');
  if (zoneName && zoneName !== 'global') {
    serverType = 'Virtual';
    virtualizationType = 'Solaris Zones';
  }
  
  // Check for LDOM
  const virtinfo = await sshExec(conn, 'virtinfo -a 2>/dev/null');
  if (virtinfo && virtinfo.includes('DOMAINROLE')) {
    if (!virtinfo.includes('impl=Domain-0') && !virtinfo.includes('control')) {
      serverType = 'Virtual';
      virtualizationType = 'Oracle VM (LDOM)';
    }
  }
  
  // Detect Oracle installations
  const oracleHomes = await detectOracleHomesLinux(conn); // oratab works on SunOS too
  const listenerInfo = await detectListenerInfoLinux(conn, oracleHomes);
  const oracleInstances = buildInstanceList(oracleHomes, listenerInfo, hostname);
  
  return {
    hostname,
    osType: 'SunOS',
    cpuModel,
    sockets,
    cores: totalCores,
    coresPerSocket: cps,
    threadsPerCore: totalLogical > totalCores ? Math.floor(totalLogical / totalCores) : 1,
    serverType,
    virtualizationType,
    hasHardPartitioning: virtualizationType === 'Oracle VM (LDOM)',
    oracleHomes,
    oracleInstances,
  };
}

// ─── HP-UX discovery commands ────────────────────────────────────────────────

async function discoverHPUX(conn: InstanceType<typeof SSHClient>): Promise<any> {
  const hostname = await sshExec(conn, 'hostname');
  
  // CPU info via machinfo
  const machinfo = await sshExec(conn, 'machinfo 2>/dev/null');
  
  let cpuModel = 'Unknown Itanium';
  let sockets = 1;
  let coresPerSocket = 1;
  let totalCores = 1;
  let threadsPerCore = 1;
  
  if (machinfo) {
    const cpuMatch = machinfo.match(/processor model:\s*(.+)/i) || machinfo.match(/CPU Model:\s*(.+)/i);
    if (cpuMatch) cpuModel = cpuMatch[1].trim();
    
    const sockMatch = machinfo.match(/(\d+)\s+socket/i);
    if (sockMatch) sockets = parseInt(sockMatch[1]);
    
    const coreMatch = machinfo.match(/(\d+)\s+core/i);
    if (coreMatch) totalCores = parseInt(coreMatch[1]);
    
    const logMatch = machinfo.match(/(\d+)\s+logical/i);
    if (logMatch) {
      const logicalCpus = parseInt(logMatch[1]);
      threadsPerCore = totalCores > 0 ? Math.floor(logicalCpus / totalCores) : 1;
    }
    
    coresPerSocket = sockets > 0 ? Math.floor(totalCores / sockets) : totalCores;
  } else {
    // Fallback: ioscan
    const ioscan = await sshExec(conn, 'ioscan -fnkC processor 2>/dev/null | grep -c processor');
    totalCores = parseInt(ioscan) || 1;
  }
  
  // Detect virtualization (HP Integrity VM / vPar / nPar)
  let serverType: 'Physical' | 'Virtual' = 'Physical';
  let virtualizationType = '';
  
  const vparStatus = await sshExec(conn, 'vparstatus 2>/dev/null | head -5');
  if (vparStatus && !vparStatus.includes('not found')) {
    serverType = 'Virtual';
    virtualizationType = 'HP vPar';
  }
  
  const hpvm = await sshExec(conn, 'hpvmstatus 2>/dev/null | head -3');
  if (hpvm && hpvm.includes('Virtual Machine')) {
    serverType = 'Virtual';
    virtualizationType = 'HP Integrity VM';
  }
  
  // nPar detection
  const npar = await sshExec(conn, 'parstatus 2>/dev/null | head -5');
  if (npar && !npar.includes('not found')) {
    virtualizationType = virtualizationType || 'HP nPar';
  }
  
  // Detect Oracle installations
  const oracleHomes = await detectOracleHomesLinux(conn);
  const listenerInfo = await detectListenerInfoLinux(conn, oracleHomes);
  const oracleInstances = buildInstanceList(oracleHomes, listenerInfo, hostname);
  
  return {
    hostname,
    osType: 'HP-UX',
    cpuModel,
    sockets,
    cores: totalCores,
    coresPerSocket,
    threadsPerCore,
    serverType,
    virtualizationType,
    hasHardPartitioning: virtualizationType === 'HP nPar' || virtualizationType === 'HP vPar',
    oracleHomes,
    oracleInstances,
  };
}

// ─── KVM Host discovery commands ─────────────────────────────────────────────

async function discoverKVMHost(conn: InstanceType<typeof SSHClient>): Promise<any> {
  // Get basic hardware info (reuse Linux logic)
  const baseData = await discoverLinux(conn);
  
  // Override: this is a hypervisor host, always physical
  baseData.osType = 'KVM-Host';
  baseData.serverType = 'Physical';
  baseData.virtualizationType = '';
  
  // Clear Oracle-related data — not relevant for hypervisor hosts
  baseData.oracleHomes = [];
  baseData.oracleInstances = [];
  
  // KVM-specific: get VM list and CPU pinning info for hard partitioning
  const kvmCpuMappings: Array<{ vmName: string; vcpus: number; pinnedCpus: string; numaNode: string }> = [];
  
  // List all VMs
  const vmList = await sshExec(conn, 'virsh list --all --name 2>/dev/null');
  if (vmList) {
    const vmNames = vmList.split('\n').map(n => n.trim()).filter(n => n.length > 0);
    
    for (const vmName of vmNames) {
      // Get vCPU count
      const vcpuInfo = await sshExec(conn, `virsh vcpucount ${vmName} --current --live 2>/dev/null || virsh vcpucount ${vmName} --maximum --config 2>/dev/null`);
      const vcpus = parseInt(vcpuInfo) || 0;
      
      // Get CPU pinning (hard partitioning)
      const vcpuPin = await sshExec(conn, `virsh vcpupin ${vmName} 2>/dev/null`);
      let pinnedCpus = '';
      if (vcpuPin) {
        // Parse pinning output: "VCPU   CPU Affinity\n 0      0-3\n 1      0-3"
        const pinLines = vcpuPin.split('\n').filter(l => /^\s*\d+/.test(l));
        const cpuSets = pinLines.map(l => {
          const parts = l.trim().split(/\s+/);
          return parts.length >= 2 ? parts[parts.length - 1] : '';
        }).filter(Boolean);
        pinnedCpus = Array.from(new Set(cpuSets)).join(', ');
      }
      
      // Get NUMA node placement
      const numaInfo = await sshExec(conn, `virsh numatune ${vmName} 2>/dev/null`);
      let numaNode = '';
      if (numaInfo) {
        const nodeMatch = numaInfo.match(/numa_nodeset\s*:\s*(.+)/);
        if (nodeMatch) numaNode = nodeMatch[1].trim();
      }
      
      kvmCpuMappings.push({ vmName, vcpus, pinnedCpus, numaNode });
    }
  }
  
  baseData.kvmCpuMappings = kvmCpuMappings;
  baseData.hasHardPartitioning = kvmCpuMappings.some(m => m.pinnedCpus && m.pinnedCpus !== '');
  
  return baseData;
}

// ─── VMware Host discovery commands ──────────────────────────────────────────

async function discoverVMwareHost(conn: InstanceType<typeof SSHClient>): Promise<any> {
  const hostname = await sshExec(conn, 'hostname -f 2>/dev/null || hostname');
  
  // ESXi-specific CPU info via esxcli or smbiosDump
  const esxcliHw = await sshExec(conn, 'esxcli hardware cpu global get 2>/dev/null');
  
  let cpuModel = 'Unknown CPU';
  let sockets = 1;
  let totalCores = 1;
  let coresPerSocket = 1;
  let threadsPerCore = 1;
  
  if (esxcliHw) {
    const cpuPkgs = esxcliHw.match(/CPU Packages:\s*(\d+)/);
    if (cpuPkgs) sockets = parseInt(cpuPkgs[1]);
    
    const coresVal = esxcliHw.match(/CPU Cores:\s*(\d+)/);
    if (coresVal) totalCores = parseInt(coresVal[1]);
    
    const threadsVal = esxcliHw.match(/CPU Threads:\s*(\d+)/);
    if (threadsVal) {
      const totalThreads = parseInt(threadsVal[1]);
      threadsPerCore = totalCores > 0 ? Math.floor(totalThreads / totalCores) : 1;
    }
    
    coresPerSocket = sockets > 0 ? Math.floor(totalCores / sockets) : totalCores;
  } else {
    // Fallback: try lscpu (unlikely on ESXi but handles edge cases)
    const lscpu = await sshExec(conn, 'lscpu 2>/dev/null');
    if (lscpu) {
      const cpuInfo = parseLscpu(lscpu);
      cpuModel = cpuInfo.modelName;
      sockets = cpuInfo.sockets;
      totalCores = cpuInfo.totalCores;
      coresPerSocket = cpuInfo.coresPerSocket;
      threadsPerCore = cpuInfo.threadsPerCore;
    }
  }
  
  // Get CPU model from esxcli
  const cpuList = await sshExec(conn, 'esxcli hardware cpu list 2>/dev/null | head -20');
  if (cpuList) {
    const brandMatch = cpuList.match(/Brand:\s*(.+)/);
    if (brandMatch) cpuModel = brandMatch[1].trim();
  }
  
  return {
    hostname,
    osType: 'VMware-Host',
    cpuModel,
    sockets,
    cores: totalCores,
    coresPerSocket,
    threadsPerCore,
    serverType: 'Physical' as const,
    virtualizationType: '',
    hasHardPartitioning: false,
    oracleHomes: [],
    oracleInstances: [],
  };
}

// ─── Windows discovery commands ──────────────────────────────────────────────

async function discoverWindows(config: { hostname: string; port: number; username: string; password: string; useHttps: boolean }): Promise<any> {
  const exec = (cmd: string) => winrmExec(config, cmd);
  
  // Gather all data with a single PowerShell script for efficiency
  const discoveryScript = `
$cpu = Get-WmiObject Win32_Processor | Select-Object -First 1
$cs = Get-WmiObject Win32_ComputerSystem
$os = Get-WmiObject Win32_OperatingSystem

$totalCores = ($cpu | Measure-Object -Property NumberOfCores -Sum).Sum
if (-not $totalCores) { $totalCores = (Get-WmiObject Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum }

$allCpu = Get-WmiObject Win32_Processor
$sockets = ($allCpu | Measure-Object).Count
$coresPerSocket = $cpu.NumberOfCores
$threads = $cpu.NumberOfLogicalProcessors
$threadsPerCore = if ($coresPerSocket -gt 0) { [math]::Floor($threads / $coresPerSocket) } else { 1 }
$totalCoresAll = ($allCpu | ForEach-Object { $_.NumberOfCores } | Measure-Object -Sum).Sum

$memGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)

# Virtualization detection
$model = $cs.Model
$manufacturer = $cs.Manufacturer
$isVirtual = $false
$virtType = ''
if ($model -match 'VMware') { $isVirtual = $true; $virtType = 'VMware' }
elseif ($model -match 'Virtual Machine' -or $manufacturer -match 'Microsoft.*Hyper-V') { $isVirtual = $true; $virtType = 'Hyper-V' }
elseif ($model -match 'KVM' -or $model -match 'QEMU') { $isVirtual = $true; $virtType = 'KVM' }
elseif ($model -match 'VirtualBox') { $isVirtual = $true; $virtType = 'VirtualBox' }
elseif ($model -match 'Xen') { $isVirtual = $true; $virtType = 'Xen' }
elseif ($manufacturer -match 'Xen') { $isVirtual = $true; $virtType = 'Xen' }
elseif ($model -match 'OVM') { $isVirtual = $true; $virtType = 'OVM (Oracle VM)' }

# Oracle services
$oraServices = Get-Service -Name 'OracleService*' -ErrorAction SilentlyContinue | Select-Object Name, Status, DisplayName
$oraListeners = Get-Service -Name 'OracleOra*TNSListener*' -ErrorAction SilentlyContinue | Select-Object Name, Status

# Oracle homes from registry
$oraHomes = @()
$regPaths = @('HKLM:\\SOFTWARE\\Oracle', 'HKLM:\\SOFTWARE\\WOW6432Node\\Oracle')
foreach ($rp in $regPaths) {
  if (Test-Path $rp) {
    Get-ChildItem $rp -ErrorAction SilentlyContinue | ForEach-Object {
      $oh = (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).ORACLE_HOME
      if ($oh -and (Test-Path $oh)) {
        $ver = 'Unknown'
        $sqlplus = Join-Path $oh 'bin\\sqlplus.exe'
        if (Test-Path $sqlplus) {
          $verOutput = & $sqlplus -V 2>&1 | Select-Object -First 1
          if ($verOutput -match '(\\d+\\.\\d+[\\.\\d]*)') { $ver = $Matches[1] }
        }
        $oraHomes += @{ Path = $oh; Version = $ver }
      }
    }
  }
}

# Build JSON output
@{
  hostname = $env:COMPUTERNAME
  osCaption = $os.Caption
  osVersion = $os.Version
  cpuModel = $cpu.Name
  sockets = $sockets
  totalCores = $totalCoresAll
  coresPerSocket = $coresPerSocket
  threadsPerCore = $threadsPerCore
  memoryGB = $memGB
  isVirtual = $isVirtual
  virtType = $virtType
  model = $model
  manufacturer = $manufacturer
  oracleServices = ($oraServices | ForEach-Object { @{ name = $_.Name; status = [string]$_.Status; displayName = $_.DisplayName } })
  oracleListeners = ($oraListeners | ForEach-Object { @{ name = $_.Name; status = [string]$_.Status } })
  oracleHomes = $oraHomes
} | ConvertTo-Json -Depth 3
`.trim();

  const resultRaw = await exec(discoveryScript);
  
  let result: any;
  try {
    result = JSON.parse(resultRaw);
  } catch (_) {
    throw new Error('Failed to parse Windows discovery output. Raw output: ' + resultRaw.substring(0, 500));
  }

  // Parse Oracle instances from service names (OracleServiceXXX → instance XXX)
  // Filter out ASM instances (names starting with +)
  const oracleInstances: string[] = [];
  if (Array.isArray(result.oracleServices)) {
    for (const svc of result.oracleServices) {
      const match = svc.name?.match(/^OracleService(.+)$/i);
      if (match && !match[1].startsWith('+')) oracleInstances.push(match[1]);
    }
  }

  // Build Oracle homes with instances
  const oracleHomes = (Array.isArray(result.oracleHomes) ? result.oracleHomes : []).map((h: any) => ({
    path: h.Path || h.path || '',
    version: h.Version || h.version || 'Unknown',
    instances: oracleInstances, // Associate all found instances
  }));

  // Build flat instances list from Windows services
  const oracleInstancesList = oracleInstances.map(name => ({
    name,
    oracleHome: oracleHomes[0]?.path || '',
    version: oracleHomes[0]?.version || 'Unknown',
    defaultPort: 1521,
    defaultServiceName: name,
    detectedHost: result.hostname || config.hostname,
  }));

  return {
    hostname: result.hostname || config.hostname,
    osType: 'Windows',
    cpuModel: result.cpuModel || 'Unknown CPU',
    sockets: result.sockets || 1,
    cores: result.totalCores || 1,
    coresPerSocket: result.coresPerSocket || 1,
    threadsPerCore: result.threadsPerCore || 1,
    serverType: result.isVirtual ? 'Virtual' : 'Physical',
    virtualizationType: result.isVirtual ? (result.virtType || 'Unknown Hypervisor') : '',
    hasHardPartitioning: false,
    oracleHomes,
    oracleInstances: oracleInstancesList,
    oracleServices: result.oracleServices || [],
    oracleListeners: result.oracleListeners || [],
  };
}

// ─── Test Connection Endpoint ────────────────────────────────────────────────

router.post('/host-conflict', validateRequest(hostConflictSchema), async (req, res, next) => {
  try {
    const { customerId, hostName } = req.body;
    getUserCustomerAccess(req, customerId);

    const duplicateHost = await findDuplicateHost(customerId, hostName);
    res.json({ duplicateHost });
  } catch (error) {
    next(error);
  }
});

router.post('/save-host', validateRequest(saveOsImportSchema), async (req, res, next) => {
  try {
    const { customerId, primaryUse, discoveryHostname, host, connectedInstances } = req.body;
    getUserCustomerAccess(req, customerId);

    const duplicateHost = await findDuplicateHost(customerId, host.name);
    if (duplicateHost) {
      return res.status(409).json({
        error: `A host named "${duplicateHost.name}" already exists for this customer. Rename it to continue.`,
        duplicateHost,
      });
    }

    const serverType = normalizeServerType(host.serverType, host.physicalHostId);

    if (serverType === 'Virtual' && host.physicalHostId) {
      const coreValidation = await validateVirtualHostCores(host.cores, host.physicalHostId);
      if (!coreValidation.valid) {
        return res.status(400).json({ error: coreValidation.message });
      }

      const virtualizationTypeValidation = await validateVirtualizationTypeConsistency(
        host.virtualizationType,
        host.physicalHostId,
      );

      if (!virtualizationTypeValidation.valid) {
        return res.status(400).json({
          error: virtualizationTypeValidation.message,
          requiredType: virtualizationTypeValidation.requiredType,
        });
      }
    }

    const coreFactor = host.coreFactor ?? await calculateCoreFactor(
      host.cpuModel,
      null,
      serverType,
      host.physicalHostId,
    );

    const result = await withTransaction(async (tx) => {
      const currentDuplicateHost = await findDuplicateHost(customerId, host.name, tx);
      if (currentDuplicateHost) {
        const error: any = new Error(`A host named "${currentDuplicateHost.name}" already exists for this customer. Rename it to continue.`);
        error.status = 409;
        error.payload = { duplicateHost: currentDuplicateHost };
        throw error;
      }

      const timestamp = new Date().toISOString();
      const createdHost = {
        id: uuidv4(),
        customerId,
        name: host.name,
        cpuModel: host.cpuModel,
        serverType,
        virtualizationType: serverType === 'Virtual' ? host.virtualizationType || null : null,
        hasHardPartitioning: host.hasHardPartitioning ?? false,
        sockets: host.sockets,
        cores: host.cores,
        threadsPerCore: host.threadsPerCore,
        coreFactor,
        physicalHostId: serverType === 'Virtual' ? host.physicalHostId || null : null,
        status: 'Active',
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await tx.insert(hosts).values(createdHost).execute();

      if (!createdHost.hasHardPartitioning) {
        await ensureCoreAssignments(createdHost.id, createdHost.cores, createdHost.hasHardPartitioning, tx);
      }

      const summary = {
        createdEnvironments: 0,
        mergedEnvironments: 0,
        skippedEnvironments: 0,
        skippedRemoteInstances: 0,
        unchangedRacInstances: 0,
        activeFeatureCount: 0,
        warnings: [] as string[],
      };

      for (const connectedInstance of connectedInstances) {
        const importData = connectedInstance.importData;
        const fallbackInstanceName = connectedInstance.instanceName;
        const environmentName = getEnvironmentNameFromImport(importData, fallbackInstanceName);
        const localInstanceName = importData.localInstanceName || fallbackInstanceName;

        if (isRemoteInstance(importData.localInstanceHost, discoveryHostname)) {
          summary.skippedRemoteInstances += 1;
          summary.warnings.push(`Skipped remote instance "${localInstanceName}" because it runs on ${importData.localInstanceHost}.`);
          continue;
        }

        const duplicateEnvironment = await findDuplicateEnvironment(customerId, environmentName, tx);
        const isRac = importData.database.isRAC === true;

        if (duplicateEnvironment && !isRac) {
          summary.skippedEnvironments += 1;
          summary.warnings.push(`Skipped environment "${environmentName}" because it already exists for this customer.`);
          continue;
        }

        if (duplicateEnvironment && isRac) {
          const currentInstances = await tx
            .select()
            .from(instances)
            .where(eq(instances.environmentId, duplicateEnvironment.id))
            .execute();

          const currentInstanceNames = new Set(currentInstances.map((instance: any) => instance.name.toLowerCase()));
          if (currentInstanceNames.has(localInstanceName.toLowerCase())) {
            summary.unchangedRacInstances += 1;
            summary.warnings.push(`Instance "${localInstanceName}" already exists in RAC environment "${environmentName}".`);
            continue;
          }

          await tx
            .insert(instances)
            .values({
              id: uuidv4(),
              environmentId: duplicateEnvironment.id,
              name: localInstanceName,
              hostId: createdHost.id,
              isPrimary: false,
              status: 'Running',
              createdAt: timestamp,
              updatedAt: timestamp,
            })
            .execute();

          await tx
            .update(environments)
            .set({
              description: duplicateEnvironment.description || `Imported from OS discovery on ${host.name} - ${importData.database.banner || fallbackInstanceName}`,
              primaryUse,
              edition: importData.database.edition || duplicateEnvironment.edition,
              version: getVersionLabel(importData),
              type: importData.database.envType || duplicateEnvironment.type,
              dbType: importData.database.dbType || duplicateEnvironment.dbType,
              isDataGuard: importData.database.isDataGuard || false,
              updatedAt: timestamp,
            })
            .where(eq(environments.id, duplicateEnvironment.id))
            .execute();

          await upsertImportedFeatureStats(tx, duplicateEnvironment.id, importData.features);
          await upsertImportedPdbs(tx, duplicateEnvironment.id, importData.pdbs);

          summary.mergedEnvironments += 1;
          summary.activeFeatureCount += importData.features.filter((feature) => feature.currentlyUsed).length;
          continue;
        }

        const environmentId = uuidv4();
        await tx
          .insert(environments)
          .values({
            id: environmentId,
            customerId,
            name: environmentName,
            description: `Imported from OS discovery on ${host.name} - ${importData.database.banner || fallbackInstanceName}`,
            type: importData.database.envType || 'Standalone',
            primaryUse,
            edition: importData.database.edition || 'Enterprise',
            version: getVersionLabel(importData),
            dbType: importData.database.dbType || 'Non-CDB',
            isDataGuard: importData.database.isDataGuard || false,
            status: 'active',
            licensable: true,
            options: JSON.stringify([]),
            managementPacks: JSON.stringify([]),
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .execute();

        await tx
          .insert(instances)
          .values({
            id: uuidv4(),
            environmentId,
            name: localInstanceName,
            hostId: createdHost.id,
            isPrimary: true,
            status: 'Running',
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .execute();

        await upsertImportedFeatureStats(tx, environmentId, importData.features);
        await upsertImportedPdbs(tx, environmentId, importData.pdbs);

        summary.createdEnvironments += 1;
        summary.activeFeatureCount += importData.features.filter((feature) => feature.currentlyUsed).length;
      }

      return { host: createdHost, summary };
    });

    const messageParts: string[] = [];
    if (result.summary.createdEnvironments > 0) {
      messageParts.push(`${result.summary.createdEnvironments} new environment(s)`);
    }
    if (result.summary.mergedEnvironments > 0) {
      messageParts.push(`${result.summary.mergedEnvironments} RAC environment(s) merged`);
    }
    if (result.summary.skippedEnvironments > 0) {
      messageParts.push(`${result.summary.skippedEnvironments} duplicate non-RAC environment(s) skipped`);
    }
    if (result.summary.skippedRemoteInstances > 0) {
      messageParts.push(`${result.summary.skippedRemoteInstances} remote instance(s) skipped`);
    }

    const message = messageParts.length > 0
      ? `"${result.host.name}" created. ${messageParts.join(', ')}.`
      : `"${result.host.name}" created.`;

    res.status(201).json({
      ...result,
      message,
    });
  } catch (error: any) {
    if (error?.status === 409) {
      return res.status(409).json({
        error: error.message,
        ...(error.payload || {}),
      });
    }

    next(error);
  }
});

router.post('/test-connection', validateRequest(sshConnectionSchema), async (req, res) => {
  const { hostname, port, username, password, osType, winrmPort, useHttps, privateKey, passphrase } = req.body;
  
  const useSSH = osType !== 'windows';
  const targetPort = useSSH ? port : winrmPort;
  
  // Step 1: TCP port check
  logger.info(`Testing TCP connectivity to ${hostname}:${targetPort} (${osType})...`);
  const tcpOk = await checkTcpPort(hostname, targetPort, 5000);
  
  if (!tcpOk) {
    const portHint = useSSH
      ? 'Ensure SSH server is running and port 22 is open.'
      : `Ensure WinRM is enabled (run 'winrm quickconfig' on the target). Port ${winrmPort} must be reachable.`;
    return res.status(400).json({
      success: false,
      message: `Cannot reach ${hostname}:${targetPort} — TCP connection refused or timed out.`,
      diagnostic: portHint,
    });
  }
  
  // Step 2: Actual connection test
  if (useSSH) {
    try {
      const conn = await connectSSH(hostname, port, username, password, privateKey, passphrase);
      const result = await sshExec(conn, 'hostname -f 2>/dev/null || hostname');
      conn.end();
      res.json({
        success: true,
        message: `Connected to ${result} via SSH (${osType})`,
        osType,
      });
    } catch (err: any) {
      let diagnostic = '';
      const msg = err.message || '';
      if (msg.includes('authentication') || msg.includes('password')) {
        diagnostic = 'Invalid username or password. Check SSH credentials.';
      } else if (msg.includes('handshake')) {
        diagnostic = 'SSH handshake failed. The server may use an unsupported key exchange algorithm.';
      }
      res.status(400).json({
        success: false,
        message: msg || 'SSH connection failed',
        diagnostic,
      });
    }
  } else {
    // Windows — WinRM
    try {
      const result = await winrmExec(
        { hostname, port: winrmPort, username, password, useHttps },
        '$env:COMPUTERNAME'
      );
      res.json({
        success: true,
        message: `Connected to ${result} via WinRM`,
        osType: 'windows',
      });
    } catch (err: any) {
      let diagnostic = '';
      const msg = err.message || '';
      if (msg.includes('401') || msg.includes('authentication')) {
        diagnostic = 'WinRM authentication failed. Ensure Basic auth is enabled: winrm set winrm/config/service/auth @{Basic="true"}';
      } else if (msg.includes('timed out')) {
        diagnostic = 'WinRM connection timed out. Run "winrm quickconfig" on the target server and check firewall rules.';
      }
      res.status(400).json({
        success: false,
        message: msg || 'WinRM connection failed',
        diagnostic,
      });
    }
  }
});

// ─── Discover OS Data Endpoint ───────────────────────────────────────────────

router.post('/discover', validateRequest(sshConnectionSchema), async (req, res) => {
  const { hostname, port, username, password, osType, winrmPort, useHttps, privateKey, passphrase } = req.body;
  
  try {
    let discoveryData: any;
    
    if (osType === 'windows') {
      discoveryData = await discoverWindows({ hostname, port: winrmPort, username, password, useHttps });
    } else {
      const conn = await connectSSH(hostname, port, username, password, privateKey, passphrase);
      try {
        switch (osType) {
          case 'sunos':
            discoveryData = await discoverSunOS(conn);
            break;
          case 'hp-ux':
            discoveryData = await discoverHPUX(conn);
            break;
          case 'kvm-host':
            discoveryData = await discoverKVMHost(conn);
            break;
          case 'vmware-host':
            discoveryData = await discoverVMwareHost(conn);
            break;
          default:
            discoveryData = await discoverLinux(conn);
            break;
        }
      } finally {
        conn.end();
      }
    }
    
    logger.info(`OS discovery completed: ${discoveryData.hostname} (${discoveryData.osType}) — ` +
      `${discoveryData.cores} cores, ${discoveryData.sockets} sockets, ` +
      `${discoveryData.serverType}${discoveryData.virtualizationType ? ` (${discoveryData.virtualizationType})` : ''}`);
    
    res.json(discoveryData);
  } catch (err: any) {
    logger.error('OS discovery failed:', err);
    res.status(400).json({
      success: false,
      message: err.message || 'Discovery failed',
    });
  }
});

// ─── SSH connect helper ──────────────────────────────────────────────────────

function connectSSH(
  host: string, port: number, username: string, password: string,
  privateKey?: string, passphrase?: string
): Promise<InstanceType<typeof SSHClient>> {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    conn.on('ready', () => resolve(conn));
    conn.on('error', (err) => reject(err));

    const connectConfig: any = {
      host,
      port,
      username,
      readyTimeout: 10000,
      algorithms: {
        kex: undefined,
        serverHostKey: undefined,
      },
    };

    if (privateKey) {
      connectConfig.privateKey = privateKey;
      if (passphrase) connectConfig.passphrase = passphrase;
    } else {
      connectConfig.password = password;
    }

    conn.connect(connectConfig);
  });
}

export default router;

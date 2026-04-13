import { Router } from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import AdmZip from 'adm-zip';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import db from '../database';
import { withTransaction } from '../utils/error-handler';
import {
  environments,
  hosts,
  instances,
  intCoreFactor,
  intDatabaseEdition,
  intDatabaseVersions,
  intEnvironmentType,
  intMultiTenant,
} from '../../shared/schema';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { validateRequest } from '../middlewares/validationMiddleware';
import { parseCpuqFile } from './review-lite/cpuq.parser';
import { parseVersionCsv } from './review-lite/version.parser';
import { parseSummaryCsv } from './review-lite/summary.parser';
import { parseDbaFeatureCsv } from './review-lite/feature.parser';
import { parseVOptionCsv } from './review-lite/option.parser';
import { parseParameterCsv } from './review-lite/parameter.parser';
import { parseLicenseCsv } from './review-lite/license.parser';
import { parseDbListCsv } from './review-lite/db-list.parser';
import { upsertReviewLiteFeatures } from './review-lite/features.service';

const router = Router();

// Configure multer for temp file uploads (100MB limit)
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Accept .tar.bz2 and .zip files
    if (
      file.originalname.endsWith('.tar.bz2') ||
      file.originalname.endsWith('.zip') ||
      file.mimetype === 'application/x-bzip2' ||
      file.mimetype === 'application/x-tar' ||
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed' ||
      file.mimetype === 'application/octet-stream'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only .tar.bz2 or .zip files are accepted'));
    }
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserCustomerAccess(req: any, customerId: string) {
  const user = req.user as { id: string; role: 'admin' | 'customer'; customerId?: string } | undefined;
  const isAdmin = user?.role === 'admin';
  const userCustomerId = user?.role === 'customer' ? user.id : user?.customerId;
  if (!isAdmin && customerId !== userCustomerId) {
    const error: any = new Error('Unauthorized access to this customer');
    error.status = 403;
    throw error;
  }
}

// ─── Parse Route ──────────────────────────────────────────────────────────────

router.post('/parse', upload.array('files', 100), async (req, res, next) => {
  const uploadedFiles = req.files as Express.Multer.File[];
  if (!uploadedFiles || uploadedFiles.length === 0) {
    return res.status(400).json({ error: 'No files uploaded. Please select one or more .tar.bz2 files.' });
  }

  // Collect results from all files, then deduplicate
  const allHosts: Map<string, ReturnType<typeof parseCpuqFile>> = new Map();
  const allDatabases: Map<string, any> = new Map(); // key = machineName_SID
  const fileNames: string[] = [];
  const skippedFiles: { name: string; reason: string }[] = [];

  for (const uploadedFile of uploadedFiles) {
    const extractDir = path.join(os.tmpdir(), `review_lite_${uuidv4()}`);
    try {
      fs.mkdirSync(extractDir, { recursive: true });

      // Extract based on file type
      const isZip = uploadedFile.originalname.endsWith('.zip');
      try {
        if (isZip) {
          const zip = new AdmZip(uploadedFile.path);
          zip.extractAllTo(extractDir, true);
        } else {
          execSync(`tar -xjf "${uploadedFile.path}" -C "${extractDir}"`, { timeout: 30000 });
        }
      } catch (extractErr: any) {
        logger.error(`Failed to extract ${uploadedFile.originalname}:`, extractErr.message);
        skippedFiles.push({ name: uploadedFile.originalname, reason: 'Error al extraer el archivo' });
        continue; // Skip this file, try others
      }

      fileNames.push(uploadedFile.originalname);

      const cpuqDir = path.join(extractDir, 'CPUQ');
      const dbDir = path.join(extractDir, 'DB');
      const logsDir = path.join(extractDir, 'logs');

      // Parse db_list to discover databases
      const dbListPath = path.join(logsDir, 'db_list.csv');
      let dbList: { sid: string; machineName: string; oracleHome: string }[] = [];
      if (fs.existsSync(dbListPath)) {
        dbList = parseDbListCsv(fs.readFileSync(dbListPath, 'utf-8'));
      }
      if (dbList.length === 0 && fs.existsSync(dbDir)) {
        const dbFolders = fs.readdirSync(dbDir).filter(f => fs.statSync(path.join(dbDir, f)).isDirectory());
        for (const folder of dbFolders) {
          const parts = folder.split('_');
          if (parts.length >= 2) {
            dbList.push({ machineName: parts[0], sid: parts.slice(1).join('_'), oracleHome: '' });
          }
        }
      }

      // Parse CPUQ file for hardware info
      // The CPUQ machine name is the real OS-level hostname of the server where
      // the script ran.  We use it as the authoritative hostname for every
      // database discovered inside this same archive, because Oracle instances
      // may each report a different HOST_NAME in version.csv / GV$INSTANCE.
      let cpuqMachineName = '';
      if (fs.existsSync(cpuqDir)) {
        const cpuqFiles = fs.readdirSync(cpuqDir).filter(f => f.endsWith('.txt'));
        for (const cpuqFile of cpuqFiles) {
          const cpuqData = parseCpuqFile(fs.readFileSync(path.join(cpuqDir, cpuqFile), 'utf-8'));
          if (cpuqData.machineName) {
            if (!cpuqMachineName) cpuqMachineName = cpuqData.machineName;
            if (!allHosts.has(cpuqData.machineName.toLowerCase())) {
              allHosts.set(cpuqData.machineName.toLowerCase(), cpuqData);
            }
          }
        }
      }

      // Build a case-insensitive lookup map for DB subdirectories
      // (Linux ext4 is case-sensitive; zip entries may differ in case from db_list.csv)
      const dbSubdirMap = new Map<string, string>(); // lowercase → actual name on disk
      if (fs.existsSync(dbDir)) {
        for (const entry of fs.readdirSync(dbDir)) {
          if (fs.statSync(path.join(dbDir, entry)).isDirectory()) {
            dbSubdirMap.set(entry.toLowerCase(), entry);
          }
        }
      }

      // Parse each database
      for (const dbEntry of dbList) {
        const expectedFolder = `${dbEntry.machineName}_${dbEntry.sid}`;
        const actualFolderName = dbSubdirMap.get(expectedFolder.toLowerCase());
        if (!actualFolderName) continue;
        const dbFolder = path.join(dbDir, actualFolderName);

        const dedupeKey = `${dbEntry.machineName}_${dbEntry.sid}`.toLowerCase();
        if (allDatabases.has(dedupeKey)) continue;

        // Resolve CSV files case-insensitively (folder contents may differ in case from db_list)
        const folderFiles = fs.readdirSync(dbFolder);
        const findFile = (suffix: string) => {
          const target = `${actualFolderName}_${suffix}`.toLowerCase();
          const found = folderFiles.find(f => f.toLowerCase() === target);
          return found ? path.join(dbFolder, found) : null;
        };

        const versionFile = findFile('version.csv');
        const summaryFile = findFile('summary.csv');
        const featureFile = findFile('dba_feature.csv');
        const optionFile = findFile('v_option.csv');
        const parameterFile = findFile('parameter.csv');
        const licenseFile = findFile('license.csv');

        const versionData = versionFile ? parseVersionCsv(fs.readFileSync(versionFile, 'utf-8')) : null;
        const summaryData = summaryFile ? parseSummaryCsv(fs.readFileSync(summaryFile, 'utf-8')) : null;
        const featureData = featureFile ? parseDbaFeatureCsv(fs.readFileSync(featureFile, 'utf-8')) : [];
        const optionData = optionFile ? parseVOptionCsv(fs.readFileSync(optionFile, 'utf-8')) : [];
        const parameterData = parameterFile ? parseParameterCsv(fs.readFileSync(parameterFile, 'utf-8')) : { cpuCount: 0 };
        const licenseData = licenseFile ? parseLicenseCsv(fs.readFileSync(licenseFile, 'utf-8')) : { sessionsMax: 0, sessionsHighwater: 0, sessionsCurrent: 0 };

        let envType = 'Standalone';
        if (summaryData?.isRAC || summaryData?.databaseType === 'RAC') {
          envType = 'RAC';
        }

        let dbType = 'Non-CDB';
        if (summaryData?.isCDB) dbType = 'CDB';

        const version = versionData?.version || summaryData?.instanceVersion || '';
        const majorVersion = parseInt(version, 10) || 0;
        const edition = versionData?.edition || summaryData?.instanceEdition || 'Enterprise';
        // Use the CPUQ machine name as the authoritative hostname for this
        // server.  Fall back to the Oracle-reported values only when CPUQ
        // data is unavailable (e.g. missing CPUQ folder).
        const hostName = cpuqMachineName || versionData?.hostName || summaryData?.instanceHost || dbEntry.machineName;

        allDatabases.set(dedupeKey, {
          sid: dbEntry.sid,
          machineName: dbEntry.machineName,
          oracleHome: dbEntry.oracleHome,
          database: {
            name: summaryData?.dbName || dbEntry.sid,
            uniqueName: summaryData?.dbUniqueName || dbEntry.sid,
            banner: versionData?.banner || '',
            edition,
            version,
            versionShort: majorVersion > 0 ? String(majorVersion) : version,
            databaseRole: summaryData?.databaseRole || 'PRIMARY',
            openMode: summaryData?.openMode || '',
            logMode: summaryData?.logMode || '',
            isDataGuard: summaryData?.isDataGuard || false,
            isRAC: summaryData?.isRAC || false,
            platform: summaryData?.platform || '',
            envType,
            dbType,
          },
          instance: {
            name: versionData?.instanceName || summaryData?.instanceName || dbEntry.sid,
            hostName,
            status: 'Running',
          },
          cpu: { cpuCount: parameterData.cpuCount },
          license: licenseData,
          features: featureData,
          dbOptions: optionData,
        });
      }
    } catch (err: any) {
      logger.error(`Error parsing file ${uploadedFile.originalname}:`, err);
      skippedFiles.push({ name: uploadedFile.originalname, reason: err.message || 'Error desconocido' });
    } finally {
      try {
        if (uploadedFile?.path) fs.unlinkSync(uploadedFile.path);
        if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        logger.warn('Cleanup of temp files failed:', cleanupErr);
      }
    }
  }

  if (allDatabases.size === 0) {
    return res.status(400).json({ error: 'No databases found in any of the uploaded files.' });
  }

  // Pre-load reference tables to map parsed values to valid entries
  const [allFactors, refEditions, refVersions, refEnvTypes, refDbTypes] = await Promise.all([
    db.select().from(intCoreFactor).execute(),
    db.select().from(intDatabaseEdition).execute(),
    db.select().from(intDatabaseVersions).execute(),
    db.select().from(intEnvironmentType).execute(),
    db.select().from(intMultiTenant).execute(),
  ]);

  const validEditions = refEditions.map(r => r.databaseEdition);
  const validVersions = refVersions.map(r => r.databaseVersion);
  const validEnvTypes = refEnvTypes.map(r => r.envType);
  const validDbTypes = refDbTypes.map(r => r.tenantType);

  // Map parsed database values to valid reference entries
  for (const [, dbData] of allDatabases) {
    // Version: extract major version and match against valid versions
    const majorVer = String(parseInt(dbData.database.version, 10) || 0);
    const matchedVersion = validVersions.find(v => v === majorVer) || dbData.database.versionShort;
    dbData.database.versionShort = matchedVersion;
    // Show the mapped version in the preview
    dbData.database.version = matchedVersion;

    // Edition: case-insensitive match
    const rawEdition = dbData.database.edition.toLowerCase();
    const matchedEdition = validEditions.find(e => rawEdition.includes(e.toLowerCase()) || e.toLowerCase().includes(rawEdition));
    if (matchedEdition) dbData.database.edition = matchedEdition;

    // Environment Type: validate against reference table
    const matchedEnvType = validEnvTypes.find(t => t.toLowerCase() === dbData.database.envType.toLowerCase());
    if (matchedEnvType) {
      dbData.database.envType = matchedEnvType;
    } else if (validEnvTypes.length > 0) {
      // Fallback: pick first valid type (usually 'Standalone' or 'Single Instance')
      const fallback = validEnvTypes.find(t => t.toLowerCase().includes('standalone') || t.toLowerCase().includes('single'));
      dbData.database.envType = fallback || validEnvTypes[0];
    }

    // DB Type (multi-tenant): validate against reference table
    const matchedDbType = validDbTypes.find(t => t.toLowerCase() === dbData.database.dbType.toLowerCase());
    if (matchedDbType) dbData.database.dbType = matchedDbType;
  }

  // Build hosts array from all CPUQ data, with core factor matching
  const hostsArray = Array.from(allHosts.values()).map(h => {
    let matchedCpuModel = h.cpuModel || 'Unknown';
    let coreFactor = 0.5;
    if (h.cpuModel) {
      const normalizedModel = h.cpuModel.toLowerCase();
      let bestMatch: { cpuModel: string; coreFactor: number } | null = null;
      for (const row of allFactors) {
        if (normalizedModel.includes(row.cpuModel.toLowerCase())) {
          if (!bestMatch || row.cpuModel.length > bestMatch.cpuModel.length) {
            bestMatch = row;
          }
        }
      }
      if (bestMatch) {
        coreFactor = bestMatch.coreFactor;
        matchedCpuModel = bestMatch.cpuModel;
      }
    }
    return {
      machineName: h.machineName,
      cpuModel: matchedCpuModel,
      cpuModelRaw: h.cpuModel,
      serverType: (h.isVirtual ? 'Virtual' : 'Physical') as 'Physical' | 'Virtual',
      sockets: h.sockets,
      coresPerSocket: h.coresPerSocket,
      totalCores: h.totalCores,
      threadsPerCore: h.threadsPerCore,
      coreFactor,
    };
  });

  const databaseResults = Array.from(allDatabases.values());

  const result = {
    fileNames,
    skippedFiles,
    hosts: hostsArray,
    databases: databaseResults,
  };

  logger.info(`Review Lite parsed: ${fileNames.length} file(s), ${hostsArray.length} host(s), ${databaseResults.length} database(s)`);
  res.json(result);
});

// ─── Save Route ────────────────────────────────────────────────────────────────

const saveReviewLiteSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({
    customerId: z.string().min(1, 'Customer ID is required'),
    createHost: z.boolean().default(true),
    hostOverrides: z.object({
      serverType: z.string().optional(),
    }).optional(),
    databases: z.array(z.object({
      selected: z.boolean().default(true),
      sid: z.string(),
      machineName: z.string().optional(),
      primaryUse: z.string().default('Production'),
      database: z.object({
        name: z.string(),
        uniqueName: z.string().optional(),
        banner: z.string().optional(),
        edition: z.string(),
        version: z.string(),
        versionShort: z.string().optional(),
        envType: z.string(),
        dbType: z.string().optional(),
        isDataGuard: z.boolean().optional(),
        isRAC: z.boolean().optional(),
        databaseRole: z.string().optional(),
      }),
      instance: z.object({
        name: z.string(),
        hostName: z.string(),
        status: z.string().optional(),
      }),
      features: z.array(z.object({
        name: z.string(),
        currentlyUsed: z.boolean(),
        detectedUsages: z.number().optional(),
        firstUsageDate: z.string().nullable().optional(),
        lastUsageDate: z.string().nullable().optional(),
      })).default([]),
    })).min(1),
    host: z.object({
      machineName: z.string(),
      cpuModel: z.string(),
      sockets: z.number(),
      totalCores: z.number(),
      threadsPerCore: z.number(),
    }).optional(),
    hosts: z.array(z.object({
      machineName: z.string(),
      cpuModel: z.string(),
      serverType: z.string().optional(),
      sockets: z.number(),
      totalCores: z.number(),
      threadsPerCore: z.number(),
      physicalHostRef: z.string().optional(), // "new:<machineName>" or "existing:<hostId>"
    })).optional(),
    hostId: z.string().optional(), // Existing host ID to assign instead of creating new
  }),
});

router.post('/save', validateRequest(saveReviewLiteSchema), async (req, res, next) => {
  try {
    const { customerId, databases, host, hosts: hostsArray, hostId, createHost, hostOverrides } = req.body;
    getUserCustomerAccess(req, customerId);

    const selectedDatabases = databases.filter((db: any) => db.selected !== false);
    if (selectedDatabases.length === 0) {
      return res.status(400).json({ error: 'No databases selected for import.' });
    }

    // Combine single host + hosts array for backward compat
    const allHostInfos: { machineName: string; cpuModel: string; sockets: number; totalCores: number; threadsPerCore: number }[] = [];
    if (hostsArray?.length) allHostInfos.push(...hostsArray);
    else if (host) allHostInfos.push(host);

    const result = await withTransaction(async (tx) => {
      // Map of machineName (lower) -> host ID (created or existing)
      const hostIdMap = new Map<string, string>();

      if (createHost && allHostInfos.length > 0 && !hostId) {
        // Pre-load all core factors for matching
        const allFactors = await tx.select().from(intCoreFactor).execute();

        // First pass: create/find Physical hosts
        for (const hostInfo of allHostInfos) {
          if ((hostInfo as any).serverType === 'Virtual') continue; // Handle virtual hosts in second pass
          const key = hostInfo.machineName.toLowerCase();
          if (hostIdMap.has(key)) continue;

          let coreFactor = 0.5;
          let matchedCpuModel = hostInfo.cpuModel || 'Unknown';
          if (hostInfo.cpuModel) {
            const normalizedModel = hostInfo.cpuModel.toLowerCase();
            let bestMatch: { cpuModel: string; coreFactor: number } | null = null;
            for (const row of allFactors) {
              if (normalizedModel.includes(row.cpuModel.toLowerCase())) {
                if (!bestMatch || row.cpuModel.length > bestMatch.cpuModel.length) bestMatch = row;
              }
            }
            if (bestMatch) { coreFactor = bestMatch.coreFactor; matchedCpuModel = bestMatch.cpuModel; }
          }

          const existingHost = await tx
            .select().from(hosts)
            .where(and(eq(hosts.customerId, customerId), sql`lower(${hosts.name}) = lower(${hostInfo.machineName})`))
            .limit(1).execute();

          if (existingHost.length > 0) {
            hostIdMap.set(key, existingHost[0].id);
            logger.info(`Review Lite: Reusing existing host "${hostInfo.machineName}" (${existingHost[0].id})`);
          } else {
            const newHostId = uuidv4();
            await tx.insert(hosts).values({
              id: newHostId, customerId, name: hostInfo.machineName,
              cpuModel: matchedCpuModel, serverType: 'Physical',
              sockets: hostInfo.sockets || 1, cores: hostInfo.totalCores || 1,
              threadsPerCore: hostInfo.threadsPerCore || 1, coreFactor,
              status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            }).execute();
            hostIdMap.set(key, newHostId);
            logger.info(`Review Lite: Created physical host "${hostInfo.machineName}" (${newHostId})`);
          }
        }

        // Second pass: create/find Virtual hosts with physicalHostId
        for (const hostInfo of allHostInfos) {
          if ((hostInfo as any).serverType !== 'Virtual') continue;
          const key = hostInfo.machineName.toLowerCase();
          if (hostIdMap.has(key)) continue;

          // Resolve physicalHostRef → actual host ID
          let physicalHostId: string | null = null;
          const ref = (hostInfo as any).physicalHostRef as string | undefined;
          if (ref) {
            if (ref.startsWith('new:')) {
              const refName = ref.substring(4).toLowerCase();
              physicalHostId = hostIdMap.get(refName) || null;
            } else if (ref.startsWith('existing:')) {
              physicalHostId = ref.substring(9);
            }
          }

          let coreFactor = 0.5;
          let matchedCpuModel = hostInfo.cpuModel || 'Unknown';
          if (hostInfo.cpuModel) {
            const normalizedModel = hostInfo.cpuModel.toLowerCase();
            let bestMatch: { cpuModel: string; coreFactor: number } | null = null;
            for (const row of allFactors) {
              if (normalizedModel.includes(row.cpuModel.toLowerCase())) {
                if (!bestMatch || row.cpuModel.length > bestMatch.cpuModel.length) bestMatch = row;
              }
            }
            if (bestMatch) { coreFactor = bestMatch.coreFactor; matchedCpuModel = bestMatch.cpuModel; }
          }

          const existingHost = await tx
            .select().from(hosts)
            .where(and(eq(hosts.customerId, customerId), sql`lower(${hosts.name}) = lower(${hostInfo.machineName})`))
            .limit(1).execute();

          if (existingHost.length > 0) {
            hostIdMap.set(key, existingHost[0].id);
            // Update physicalHostId if not yet set
            if (physicalHostId && !existingHost[0].physicalHostId) {
              await tx.update(hosts).set({ physicalHostId, serverType: 'Virtual', updatedAt: new Date().toISOString() })
                .where(eq(hosts.id, existingHost[0].id)).execute();
            }
            logger.info(`Review Lite: Reusing existing host "${hostInfo.machineName}" (${existingHost[0].id})`);
          } else {
            const newHostId = uuidv4();
            await tx.insert(hosts).values({
              id: newHostId, customerId, name: hostInfo.machineName,
              cpuModel: matchedCpuModel, serverType: 'Virtual',
              virtualizationType: 'VMware',
              sockets: hostInfo.sockets || 1, cores: hostInfo.totalCores || 1,
              threadsPerCore: hostInfo.threadsPerCore || 1, coreFactor,
              physicalHostId: physicalHostId,
              status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            }).execute();
            hostIdMap.set(key, newHostId);
            logger.info(`Review Lite: Created virtual host "${hostInfo.machineName}" → physical "${physicalHostId}" (${newHostId})`);
          }
        }
      } else if (hostId) {
        // Use single hostId for all
        hostIdMap.set('__default__', hostId);
      }

      const createdEnvironments: { id: string; name: string; mode: string }[] = [];

      for (const dbEntry of selectedDatabases) {
        // Resolve host: match by machineName or use default
        const assignedHostId =
          hostIdMap.get(dbEntry.instance.hostName?.toLowerCase()) ||
          hostIdMap.get(dbEntry.machineName?.toLowerCase()) ||
          hostIdMap.get('__default__') ||
          (hostIdMap.size === 1 ? hostIdMap.values().next().value : '');

        if (!assignedHostId) {
          logger.warn(`Review Lite: No host found for database "${dbEntry.database.name}" (host: ${dbEntry.instance.hostName})`);
          continue;
        }

        const environmentName = dbEntry.database.uniqueName || dbEntry.database.name || dbEntry.sid;
        const versionLabel = dbEntry.database.versionShort || String(parseInt(dbEntry.database.version, 10) || dbEntry.database.version);

        // Check for duplicate environment
        const existingEnv = await tx
          .select()
          .from(environments)
          .where(and(
            eq(environments.customerId, customerId),
            sql`lower(${environments.name}) = lower(${environmentName})`,
          ))
          .limit(1)
          .execute();

        if (existingEnv.length > 0) {
          // Update existing environment
          const envId = existingEnv[0].id;
          await tx
            .update(environments)
            .set({
              edition: dbEntry.database.edition || existingEnv[0].edition,
              version: versionLabel,
              type: dbEntry.database.envType || existingEnv[0].type,
              dbType: dbEntry.database.dbType || existingEnv[0].dbType || '',
              isDataGuard: dbEntry.database.isDataGuard || false,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(environments.id, envId))
            .execute();

          // Upsert features
          await upsertReviewLiteFeatures(tx, envId, dbEntry.features);

          // Add instance if not duplicate
          const existingInst = await tx
            .select()
            .from(instances)
            .where(and(
              eq(instances.environmentId, envId),
              sql`lower(${instances.name}) = lower(${dbEntry.instance.name})`,
            ))
            .limit(1)
            .execute();

          if (existingInst.length === 0) {
            await tx.insert(instances).values({
              id: uuidv4(),
              environmentId: envId,
              name: dbEntry.instance.name,
              hostId: assignedHostId,
              isPrimary: true,
              status: dbEntry.instance.status || 'Running',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }).execute();
          }

          createdEnvironments.push({ id: envId, name: environmentName, mode: 'updated' });
        } else {
          // Create new environment
          const envId = uuidv4();
          await tx
            .insert(environments)
            .values({
              id: envId,
              customerId,
              name: environmentName,
              description: `Imported from Review Lite - ${dbEntry.database.banner || dbEntry.sid}`,
              type: dbEntry.database.envType || 'Standalone',
              primaryUse: dbEntry.primaryUse || 'Production',
              edition: dbEntry.database.edition || 'Enterprise',
              version: versionLabel,
              dbType: dbEntry.database.dbType || '',
              isDataGuard: dbEntry.database.isDataGuard || false,
              status: 'active',
              licensable: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            .execute();

          // Create instance
          await tx.insert(instances).values({
            id: uuidv4(),
            environmentId: envId,
            name: dbEntry.instance.name,
            hostId: assignedHostId,
            isPrimary: true,
            status: dbEntry.instance.status || 'Running',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }).execute();

          // Insert features
          await upsertReviewLiteFeatures(tx, envId, dbEntry.features);

          createdEnvironments.push({ id: envId, name: environmentName, mode: 'created' });
        }
      }

      // Post-hoc RAC detection: if an environment has instances on 2+ distinct
      // hosts, it is a RAC cluster regardless of what DATABASE_TYPE reported.
      const processedEnvIds = new Set(createdEnvironments.map(e => e.id));
      for (const envId of processedEnvIds) {
        const envInstances = await tx
          .select({ hostId: instances.hostId })
          .from(instances)
          .where(eq(instances.environmentId, envId))
          .execute();
        const distinctHosts = new Set(envInstances.map((i: any) => i.hostId));
        if (distinctHosts.size >= 2) {
          await tx
            .update(environments)
            .set({ type: 'RAC', updatedAt: new Date().toISOString() })
            .where(eq(environments.id, envId))
            .execute();
        }
      }

      return {
        hostIds: Array.from(hostIdMap.values()),
        hostNames: allHostInfos.map(h => h.machineName),
        environments: createdEnvironments,
      };
    });

    logger.info(`Review Lite saved: ${result.environments.length} environment(s), ${result.hostNames.length} host(s)`);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;

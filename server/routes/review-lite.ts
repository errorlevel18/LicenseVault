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
  featureStats,
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

/**
 * Normalize a raw /proc/cpuinfo model name to match the int_core_factor table.
 * E.g. "Intel(R) Xeon(R) Gold 5418Y" → "Intel Xeon Gold 5418Y"
 */
function normalizeCpuModel(raw: string): string {
  return raw
    .replace(/\(R\)/gi, '')
    .replace(/\(TM\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse the CPUQ text file to extract hardware info.
 * Returns: machineName, osName, osRelease, cpuModel, sockets, coresPerSocket, threadsPerCore
 */
function parseCpuqFile(content: string) {
  const lines = content.split('\n');
  let machineName = '';
  let osName = '';
  let osRelease = '';
  let cpuModel = '';
  let isVirtual = false;
  const physicalIds = new Set<string>();
  let coresPerSocket = 0;
  let siblings = 0;

  // Windows-specific fields
  let winCpuModel = '';
  let winProcessorCount = 0;
  let winCoresPerProc = 0;
  let winLogicalPerProc = 0;
  let isWindows = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // ── Linux /proc/cpuinfo format ──
    if (trimmed.startsWith('Machine Name=')) {
      machineName = trimmed.split('=')[1]?.trim() || '';
    } else if (trimmed.startsWith('Operating System Name=')) {
      osName = trimmed.split('=')[1]?.trim() || '';
    } else if (trimmed.startsWith('Operating System Release=')) {
      osRelease = trimmed.split('=')[1]?.trim() || '';
    } else if (trimmed.startsWith('model name')) {
      const val = trimmed.split(':')[1]?.trim();
      if (val && !cpuModel) cpuModel = val;
    } else if (trimmed.startsWith('physical id')) {
      const val = trimmed.split(':')[1]?.trim();
      if (val !== undefined) physicalIds.add(val);
    } else if (trimmed.startsWith('cpu cores')) {
      const val = parseInt(trimmed.split(':')[1]?.trim() || '0', 10);
      if (val > coresPerSocket) coresPerSocket = val;
    } else if (trimmed.startsWith('siblings')) {
      const val = parseInt(trimmed.split(':')[1]?.trim() || '0', 10);
      if (val > siblings) siblings = val;
    }

    // ── Windows cpuq.cmd format ──
    else if (trimmed.startsWith('Computer Name:')) {
      machineName = trimmed.replace('Computer Name:', '').trim();
      isWindows = true;
    } else if (trimmed.startsWith('"ProcessorNameString"=')) {
      const match = trimmed.match(/"ProcessorNameString"="([^"]+)"/);
      if (match && !winCpuModel) winCpuModel = match[1];
    } else if (trimmed.startsWith('VIRTUAL MACHINE RUNNING:')) {
      isVirtual = true;
    } else if (trimmed.startsWith('CPU NumberOfCores:')) {
      const val = parseInt(trimmed.replace('CPU NumberOfCores:', '').trim(), 10);
      if (!isNaN(val) && val > 0) {
        winProcessorCount++;
        winCoresPerProc = val; // last value (they're typically identical)
      }
    } else if (trimmed.startsWith('CPU NumberOfLogicalProcessors:')) {
      const val = parseInt(trimmed.replace('CPU NumberOfLogicalProcessors:', '').trim(), 10);
      if (!isNaN(val) && val > 0) winLogicalPerProc = val;
    }
  }

  // Use Windows data if Linux fields are empty
  if (isWindows && !cpuModel && winCpuModel) {
    cpuModel = winCpuModel;
  }

  let sockets: number;
  let totalCores: number;
  let threadsPerCore: number;

  if (isWindows && winProcessorCount > 0) {
    sockets = winProcessorCount;
    coresPerSocket = winCoresPerProc || 1;
    totalCores = sockets * coresPerSocket;
    threadsPerCore = winLogicalPerProc > 0 && winCoresPerProc > 0
      ? Math.round(winLogicalPerProc / winCoresPerProc)
      : 1;
  } else {
    sockets = physicalIds.size || 1;
    totalCores = sockets * coresPerSocket;
    threadsPerCore = coresPerSocket > 0 && siblings > 0
      ? Math.round(siblings / coresPerSocket)
      : 1;
  }

  return {
    machineName,
    osName,
    osRelease,
    cpuModel: normalizeCpuModel(cpuModel),
    sockets,
    coresPerSocket,
    totalCores,
    threadsPerCore,
    isVirtual,
  };
}

/**
 * Parse the version.csv to extract banner, edition, version, hostName, instanceName.
 */
function parseVersionCsv(content: string) {
  // The file has a header section "DATABASE VERSION" then CSV data
  // Format: AUDIT_ID,BANNER,HOST_NAME,INSTANCE_NAME,SYSDATE
  const lines = content.split('\n');
  let banner = '';
  let hostName = '';
  let instanceName = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('-') || trimmed.startsWith('AUDIT_ID') || trimmed.startsWith('DATABASE')) continue;
    // Parse CSV row — banner may contain commas inside quotes
    const match = trimmed.match(/^(\d+),"([^"]*)",([^,]*),([^,]*),/);
    if (match) {
      banner = match[2];
      hostName = match[3];
      instanceName = match[4];
      break;
    }
  }

  // Extract edition from banner
  let edition = 'Enterprise';
  if (banner.includes('Standard Edition Two') || banner.includes('Standard Edition 2')) {
    edition = 'Standard Edition 2';
  } else if (banner.includes('Standard Edition')) {
    edition = 'Standard Edition';
  } else if (banner.includes('Personal Edition')) {
    edition = 'Personal Edition';
  } else if (banner.includes('Express Edition')) {
    edition = 'Express Edition';
  }

  // Extract version from banner: e.g. "Release 19.0.0.0.0"
  let version = '';
  const versionMatch = banner.match(/Release\s+(\d+\.\d+[\.\d]*)/);
  if (versionMatch) {
    version = versionMatch[1];
  }

  return { banner, edition, version, hostName, instanceName };
}

/**
 * Parse the summary.csv to get V$DATABASE info (name, role, dataguard, logmode, dbtype, etc.)
 * and GV$INSTANCE info.
 */
function parseSummaryCsv(content: string) {
  const result: {
    dbName: string;
    dbUniqueName: string;
    databaseRole: string;
    openMode: string;
    logMode: string;
    isDataGuard: boolean;
    platform: string;
    isCDB: boolean;
    isRAC: boolean;
    instanceName: string;
    instanceHost: string;
    instanceVersion: string;
    instanceEdition: string;
    databaseType: string;
  } = {
    dbName: '',
    dbUniqueName: '',
    databaseRole: '',
    openMode: '',
    logMode: '',
    isDataGuard: false,
    platform: '',
    isCDB: false,
    isRAC: false,
    instanceName: '',
    instanceHost: '',
    instanceVersion: '',
    instanceEdition: '',
    databaseType: '',
  };

  // Parse V$DATABASE section
  // The data is in a fixed-width format, need to find the data line
  const lines = content.split('\n');
  let inVDatabase = false;
  let inGVInstance = false;
  let vdbDataLines: string[] = [];
  let gvInstDataLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('V$DATABASE') && !line.includes('GV$')) {
      inVDatabase = true;
      inGVInstance = false;
      continue;
    }
    if (line.includes('GV$INSTANCE')) {
      inGVInstance = true;
      inVDatabase = false;
      continue;
    }

    // Collect data lines (skip headers and separators)
    if (inVDatabase && !line.startsWith('-') && !line.startsWith(' ') && line.trim() && !line.includes('DBID') && !line.includes('PLATFORM') && !line.includes('PENDING') && !line.includes('CON_DBID') && !line.includes('CDB') && !line.includes('row')) {
      // This is likely a data line starting with DBID number
      if (/^\d/.test(line.trim())) {
        vdbDataLines.push(line.trim());
      }
    }
    if (inGVInstance && !line.startsWith('-') && !line.startsWith(' ') && line.trim() && !line.includes('INST_ID') && !line.includes('FAMILY') && !line.includes('row')) {
      if (/^\s*\d/.test(line)) {
        gvInstDataLines.push(line.trim());
      }
    }
  }

  // Parse V$DATABASE data - extract DB name, role etc.
  if (vdbDataLines.length > 0) {
    const dataLine = vdbDataLines[0];
    // DBID and NAME may be separated by a single space (fixed-width Oracle output).
    // First split: tokens separated by 2+ spaces.
    const parts = dataLine.split(/\s{2,}/);
    // The first token might be "1970590186 HDTESTP" — split further by single space.
    const firstTokenParts = (parts[0] || '').split(/\s+/);
    if (firstTokenParts.length >= 2 && /^\d+$/.test(firstTokenParts[0])) {
      result.dbName = firstTokenParts[1];
    } else if (parts.length >= 2) {
      result.dbName = parts[1]?.trim() || '';
    }
    // Look for DATABASE_ROLE
    if (dataLine.includes('PHYSICAL STANDBY')) result.databaseRole = 'PHYSICAL STANDBY';
    else if (dataLine.includes('PRIMARY')) result.databaseRole = 'PRIMARY';
    else if (dataLine.includes('LOGICAL STANDBY')) result.databaseRole = 'LOGICAL STANDBY';
    // OPEN_MODE
    if (dataLine.includes('READ WRITE')) result.openMode = 'READ WRITE';
    else if (dataLine.includes('READ ONLY WITH APPLY')) result.openMode = 'READ ONLY WITH APPLY';
    else if (dataLine.includes('READ ONLY')) result.openMode = 'READ ONLY';
    else if (dataLine.includes('MOUNTED')) result.openMode = 'MOUNTED';
    // LOG_MODE
    if (dataLine.includes('ARCHIVELOG')) result.logMode = 'ARCHIVELOG';
    else if (dataLine.includes('NOARCHIVELOG')) result.logMode = 'NOARCHIVELOG';
    // DATAGUARD_BROKER
    result.isDataGuard = dataLine.includes('ENABLED');
  }

  // Extract DB_UNIQUE_NAME by finding the column header position and reading the
  // value at the same character offset in the data line below it.  The old regex
  // approach was fragile and could match DATABASE_ROLE=PRIMARY instead.
  for (let i = 0; i < lines.length; i++) {
    const colIndex = lines[i].indexOf('DB_UNIQUE_NAME');
    if (colIndex < 0) continue;
    // Skip separator lines (---) and blanks to reach the data line
    for (let j = i + 1; j < lines.length; j++) {
      const dl = lines[j];
      if (dl.startsWith('-') || !dl.trim()) continue;
      if (dl.includes('row selected') || dl.includes('rows selected')) break;
      if (dl.length > colIndex) {
        const token = dl.substring(colIndex).trim().split(/\s+/)[0];
        if (token && !/^[-]+$/.test(token)) {
          result.dbUniqueName = token;
        }
      }
      break;
    }
    break;
  }
  // Fallback to dbName
  if (!result.dbUniqueName && result.dbName) {
    result.dbUniqueName = result.dbName;
  }

  // Search the raw content for platform and CDB status
  const platformMatch = content.match(/Linux x86 64-bit|AIX-Based|HP-UX|Solaris|Microsoft Windows/);
  if (platformMatch) result.platform = platformMatch[0];

  // CDB detection
  const cdbMatch = content.match(/CDB\s*\n-+\n(YES|NO)/);
  if (cdbMatch) {
    result.isCDB = cdbMatch[1] === 'YES';
  }

  // Parse GV$INSTANCE
  if (gvInstDataLines.length > 0) {
    const instLine = gvInstDataLines[0];
    const instParts = instLine.split(/\s{2,}/);
    // INST_ID INSTANCE_NUMBER INSTANCE_NAME HOST_NAME VERSION ...
    if (instParts.length >= 5) {
      result.instanceName = instParts[2]?.trim() || '';
      result.instanceHost = instParts[3]?.trim() || '';
      result.instanceVersion = instParts[4]?.trim() || '';
    }
    // EDITION at end
    if (instLine.includes(' EE')) result.instanceEdition = 'Enterprise';
    else if (instLine.includes(' SE2')) result.instanceEdition = 'Standard Edition 2';
    else if (instLine.includes(' SE')) result.instanceEdition = 'Standard Edition';
    else if (instLine.includes(' XE')) result.instanceEdition = 'Express Edition';
  }

  // Detect real RAC: count distinct INST_ID values in GV$INSTANCE data lines.
  // Oracle may report DATABASE_TYPE=RAC even on single-instance databases when
  // the RAC option is installed.  Only classify as RAC when there are 2+ instances.
  const distinctInstIds = new Set<string>();
  for (const dl of gvInstDataLines) {
    const instIdMatch = dl.match(/^\s*(\d+)/);
    if (instIdMatch) distinctInstIds.add(instIdMatch[1]);
  }
  const multipleInstances = distinctInstIds.size >= 2;

  if (gvInstDataLines.length > 1) {
    const familyLine = gvInstDataLines[1];
    if (familyLine.includes('RAC') && multipleInstances) {
      result.isRAC = true;
      result.databaseType = 'RAC';
    } else if (familyLine.includes('SINGLE') || !multipleInstances) {
      result.databaseType = 'SINGLE';
    }
  }

  return result;
}

/**
 * Parse the dba_feature.csv to extract feature usage statistics.
 */
function parseDbaFeatureCsv(content: string) {
  // Format: AUDIT_ID,DBID,NAME,VERSION,DETECTED_USAGES,TOTAL_SAMPLES,CURRENTLY_USED,FIRST_USAGE_DATE,LAST_USAGE_DATE,...
  const lines = content.split('\n');
  const features: {
    name: string;
    version: string;
    detectedUsages: number;
    currentlyUsed: boolean;
    firstUsageDate: string | null;
    lastUsageDate: string | null;
    description: string;
  }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('-') || trimmed.startsWith('AUDIT_ID') || trimmed.startsWith('10g') || !trimmed.startsWith('0,')) continue;

    // Parse CSV: 0,"DBID","NAME","VERSION","DETECTED_USAGES","TOTAL_SAMPLES","CURRENTLY_USED","FIRST","LAST","AUX","FEATURE_INFO","LAST_SAMPLE","LAST_SAMPLE_PERIOD","SAMPLE_INTERVAL","DESCRIPTION",...
    const parts = parseReviewLiteCsvLine(trimmed);
    if (parts.length < 7) continue;

    const name = unquote(parts[2]);
    const version = unquote(parts[3]);
    const detectedUsages = parseInt(unquote(parts[4]), 10) || 0;
    const currentlyUsed = unquote(parts[6]).toUpperCase() === 'TRUE';
    const firstUsageDate = unquote(parts[7]) || null;
    const lastUsageDate = unquote(parts[8]) || null;
    const description = parts.length > 14 ? unquote(parts[14]) : '';

    features.push({
      name,
      version,
      detectedUsages,
      currentlyUsed,
      firstUsageDate: firstUsageDate ? firstUsageDate.replace(/_/g, ' ') : null,
      lastUsageDate: lastUsageDate ? lastUsageDate.replace(/_/g, ' ') : null,
      description,
    });
  }

  return features;
}

/**
 * Parse the v_option.csv to extract database options.
 */
function parseVOptionCsv(content: string) {
  const lines = content.split('\n');
  const options: { parameter: string; value: string }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('-') || trimmed.startsWith('AUDIT_ID') || trimmed.startsWith('DATABASE')) continue;
    if (!trimmed.startsWith('0,')) continue;

    const parts = trimmed.split(',');
    if (parts.length < 3) continue;
    options.push({
      parameter: parts[1]?.trim() || '',
      value: parts[2]?.trim() || '',
    });
  }

  return options;
}

/**
 * Parse the parameter.csv to extract cpu_count.
 */
function parseParameterCsv(content: string) {
  const lines = content.split('\n');
  let cpuCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('0,')) continue;
    const parts = trimmed.split(',');
    if (parts[1]?.trim() === 'cpu_count') {
      cpuCount = parseInt(parts[2]?.trim() || '0', 10) || 0;
    }
  }

  return { cpuCount };
}

/**
 * Parse the license.csv to extract session info.
 */
function parseLicenseCsv(content: string) {
  const lines = content.split('\n');
  let sessionsMax = 0;
  let sessionsHighwater = 0;
  let sessionsCurrent = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('0,')) continue;
    const parts = trimmed.split(',');
    if (parts.length >= 5) {
      sessionsMax = parseInt(parts[1]?.trim() || '0', 10) || 0;
      sessionsCurrent = parseInt(parts[3]?.trim() || '0', 10) || 0;
      sessionsHighwater = parseInt(parts[4]?.trim() || '0', 10) || 0;
    }
  }

  return { sessionsMax, sessionsHighwater, sessionsCurrent };
}

/**
 * Simple CSV line parser that respects quoted fields.
 */
function parseReviewLiteCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function unquote(s: string | undefined): string {
  if (!s) return '';
  return s.replace(/^"|"$/g, '').trim();
}

/**
 * Parse the db_list.csv to get a list of databases in the collection.
 */
function parseDbListCsv(content: string) {
  const lines = content.split('\n');
  const databases: { sid: string; machineName: string; oracleHome: string }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('CONNECTION_METHOD')) continue;
    const parts = trimmed.split(',');
    if (parts.length >= 12) {
      databases.push({
        sid: parts[2]?.trim() || '',
        machineName: parts[11]?.trim() || '',
        oracleHome: parts[1]?.trim() || '',
      });
    }
  }

  return databases;
}

// ─── Parse Route ──────────────────────────────────────────────────────────────

router.post('/parse', upload.array('files', 50), async (req, res, next) => {
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

async function upsertReviewLiteFeatures(tx: any, environmentId: string, features: any[]) {
  if (!features.length) return;

  const existing = await tx
    .select()
    .from(featureStats)
    .where(eq(featureStats.environmentId, environmentId))
    .execute();

  const existingMap = new Map<string, any>(existing.map((f: any) => [f.name.toLowerCase(), f]));

  for (const feature of features) {
    const existingFeature = existingMap.get(feature.name.toLowerCase());
    if (existingFeature) {
      await tx
        .update(featureStats)
        .set({
          currentlyUsed: feature.currentlyUsed,
          detectedUsages: feature.detectedUsages || 0,
          firstUsageDate: feature.firstUsageDate || null,
          lastUsageDate: feature.lastUsageDate || null,
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
          firstUsageDate: feature.firstUsageDate || null,
          lastUsageDate: feature.lastUsageDate || null,
          status: 'Not Licensed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .execute();
    }
  }
}

export default router;

/**
 * Parse the summary.csv to get V$DATABASE info (name, role, dataguard, logmode, dbtype, etc.)
 * and GV$INSTANCE info.
 */
export function parseSummaryCsv(content: string) {
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
    // OPEN_MODE
    if (dataLine.includes('READ WRITE')) result.openMode = 'READ WRITE';
    else if (dataLine.includes('READ ONLY WITH APPLY')) result.openMode = 'READ ONLY WITH APPLY';
    else if (dataLine.includes('READ ONLY')) result.openMode = 'READ ONLY';
    else if (dataLine.includes('MOUNTED')) result.openMode = 'MOUNTED';
    // LOG_MODE
    if (dataLine.includes('ARCHIVELOG')) result.logMode = 'ARCHIVELOG';
    else if (dataLine.includes('NOARCHIVELOG')) result.logMode = 'NOARCHIVELOG';
  }

  // Extract DATABASE_ROLE and DATAGUARD_BROKER by column header position
  // to avoid false matches (e.g. "ENABLED" in FORCE_LOGGING, "PRIMARY" in other fields).
  const headerFields: { header: string; setter: (val: string) => void }[] = [
    { header: 'DATABASE_ROLE', setter: (val) => {
      result.databaseRole = val;
      // A database is Data Guard if its role is any kind of STANDBY
      result.isDataGuard = val.includes('STANDBY');
    }},
  ];
  for (const { header, setter } of headerFields) {
    for (let i = 0; i < lines.length; i++) {
      const colIndex = lines[i].indexOf(header);
      if (colIndex < 0) continue;
      for (let j = i + 1; j < lines.length; j++) {
        const dl = lines[j];
        if (dl.startsWith('-') || !dl.trim()) continue;
        if (dl.includes('row selected') || dl.includes('rows selected')) break;
        if (dl.length > colIndex) {
          // Read until next column (2+ spaces or end of line)
          const remainder = dl.substring(colIndex).trimStart();
          const token = remainder.split(/\s{2,}/)[0]?.trim();
          if (token && !/^[-]+$/.test(token)) setter(token);
        }
        break;
      }
      break;
    }
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

  // Extract DATABASE_TYPE from GV$INSTANCE by column header position.
  // The old approach read gvInstDataLines[1] as the "FAMILY" line, but that
  // line was actually filtered out; index 1 was the second instance data line
  // whose hostname (e.g. "mabd01orarac84") could false-match "RAC".
  let detectedDbType = '';
  for (let i = 0; i < lines.length; i++) {
    const colIndex = lines[i].indexOf('DATABASE_TYPE');
    if (colIndex < 0) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const dl = lines[j];
      if (dl.startsWith('-') || !dl.trim()) continue;
      if (dl.includes('row selected') || dl.includes('rows selected')) break;
      if (dl.length > colIndex) {
        const token = dl.substring(colIndex).trim().split(/\s+/)[0];
        if (token && !/^[-]+$/.test(token)) {
          detectedDbType = token;
        }
      }
      break;
    }
    break;
  }

  if (detectedDbType === 'RAC' && multipleInstances) {
    result.isRAC = true;
    result.databaseType = 'RAC';
  } else if (detectedDbType === 'RACONENODE') {
    result.databaseType = 'RAC One Node';
  } else {
    result.databaseType = 'SINGLE';
  }

  return result;
}

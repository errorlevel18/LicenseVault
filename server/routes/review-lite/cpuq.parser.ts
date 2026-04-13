/**
 * Normalize a raw /proc/cpuinfo model name to match the int_core_factor table.
 * E.g. "Intel(R) Xeon(R) Gold 5418Y" → "Intel Xeon Gold 5418Y"
 */
export function normalizeCpuModel(raw: string): string {
  return raw
    .replace(/\(R\)/gi, '')
    .replace(/\(TM\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CpuqData {
  machineName: string;
  osName: string;
  osRelease: string;
  cpuModel: string;
  sockets: number;
  coresPerSocket: number;
  totalCores: number;
  threadsPerCore: number;
  isVirtual: boolean;
}

/**
 * Parse the CPUQ text file to extract hardware info.
 */
export function parseCpuqFile(content: string): CpuqData {
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
        winCoresPerProc = val;
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

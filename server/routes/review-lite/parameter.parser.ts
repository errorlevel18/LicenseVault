/**
 * Parse the parameter.csv to extract cpu_count.
 */
export function parseParameterCsv(content: string) {
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

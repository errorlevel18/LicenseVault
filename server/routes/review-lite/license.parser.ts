/**
 * Parse the license.csv to extract session info.
 */
export function parseLicenseCsv(content: string) {
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

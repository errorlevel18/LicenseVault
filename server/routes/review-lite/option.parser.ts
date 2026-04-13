/**
 * Parse the v_option.csv to extract database options.
 */
export function parseVOptionCsv(content: string) {
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

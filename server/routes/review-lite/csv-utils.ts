/**
 * Simple CSV line parser that respects quoted fields.
 */
export function parseReviewLiteCsvLine(line: string): string[] {
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

export function unquote(s: string | undefined): string {
  if (!s) return '';
  return s.replace(/^"|"$/g, '').trim();
}

/**
 * Extract a column value from Oracle fixed-width output by header position.
 * Finds the header text, then reads the value at the same character offset
 * in the first data line below it.
 */
export function extractColumnByHeader(lines: string[], header: string): string | null {
  for (let i = 0; i < lines.length; i++) {
    const colIndex = lines[i].indexOf(header);
    if (colIndex < 0) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const dl = lines[j];
      if (dl.startsWith('-') || !dl.trim()) continue;
      if (dl.includes('row selected') || dl.includes('rows selected')) break;
      if (dl.length > colIndex) {
        const remainder = dl.substring(colIndex).trimStart();
        const token = remainder.split(/\s{2,}/)[0]?.trim();
        if (token && !/^[-]+$/.test(token)) return token;
      }
      break;
    }
    break;
  }
  return null;
}

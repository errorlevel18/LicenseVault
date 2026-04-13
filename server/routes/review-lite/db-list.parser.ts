/**
 * Parse the db_list.csv to get a list of databases in the collection.
 */
export function parseDbListCsv(content: string) {
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

/**
 * Parse the version.csv to extract banner, edition, version, hostName, instanceName.
 */
export function parseVersionCsv(content: string) {
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

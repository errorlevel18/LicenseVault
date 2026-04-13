import { parseReviewLiteCsvLine, unquote } from './csv-utils';

/**
 * Parse the dba_feature.csv to extract feature usage statistics.
 */
export function parseDbaFeatureCsv(content: string) {
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

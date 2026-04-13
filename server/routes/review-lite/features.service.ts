import { eq } from 'drizzle-orm';
import { featureStats } from '../../../shared/schema';

export async function upsertReviewLiteFeatures(tx: any, environmentId: string, features: any[]) {
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

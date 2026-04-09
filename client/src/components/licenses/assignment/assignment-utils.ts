import { Host } from "@/lib/types";

export function getHostCoreLicenseMap(host?: Host | null): Record<number, string[]> {
  const assignments = new Map<number, Set<string>>();

  // Primary source: coreArray (returned by GET /hosts with enriched data)
  if (host?.coreArray && host.coreArray.length > 0) {
    host.coreArray.forEach((entry) => {
      if (!entry.licenses || entry.licenses.length === 0) return;

      if (!assignments.has(entry.coreId)) {
        assignments.set(entry.coreId, new Set());
      }

      entry.licenses.forEach((licenseId) => {
        assignments.get(entry.coreId)?.add(licenseId);
      });
    });
  }

  // Fallback: coreAssignments (legacy format, one entry per core-license pair)
  if (assignments.size === 0 && host?.coreAssignments && host.coreAssignments.length > 0) {
    host.coreAssignments.forEach((assignment) => {
      if (!assignment.licenseId) return;

      if (!assignments.has(assignment.coreId)) {
        assignments.set(assignment.coreId, new Set());
      }

      assignments.get(assignment.coreId)?.add(assignment.licenseId);
    });
  }

  return Object.fromEntries(
    Array.from(assignments.entries()).map(([coreId, licenseIds]) => [coreId, Array.from(licenseIds)]),
  );
}

export function getHostAssignedLicenseIds(host?: Host | null): string[] {
  const coreLicenseMap = getHostCoreLicenseMap(host);

  return Array.from(
    new Set(Object.values(coreLicenseMap).flat()),
  );
}

export function hostHasAssignments(host?: Host | null): boolean {
  return getHostAssignedLicenseIds(host).length > 0;
}

export function isLicenseAssignedToHost(host: Host | undefined | null, licenseId: string): boolean {
  return getHostAssignedLicenseIds(host).includes(licenseId);
}

export function countAssignedCoresForLicense(host: Host | undefined | null, licenseId: string): number {
  const coreLicenseMap = getHostCoreLicenseMap(host);

  return Object.values(coreLicenseMap).filter((licenseIds) => licenseIds.includes(licenseId)).length;
}
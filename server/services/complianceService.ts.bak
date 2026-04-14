import db from '../database';
import logger from '../utils/logger';
import {
  environments, instances, hosts, featureStats, licenses, coreAssignments,
  coreLicenseMappings, intLicenseProducts
} from '../../shared/schema';
import { and, eq, like, ne, or, sql } from 'drizzle-orm';

// Constants
export const NUP_PER_PROCESSOR = 25;
export const NUP_STANDARD_MINIMUM = 10;

const SYSTEM_MANAGED_FEATURE_SUFFIX = /\s*\(system\)\s*$/i;

export function isSystemManagedFeatureName(featureName: string) {
  return SYSTEM_MANAGED_FEATURE_SUFFIX.test(featureName.trim());
}

export function filterComplianceRelevantFeatureUsage<T extends { name: string }>(
  featureUsage: T[]
) {
  return featureUsage.filter((feature) => !isSystemManagedFeatureName(feature.name));
}

// ─── Processor License Calculation ───────────────────────────────────────────

export async function calculateProcessorLicenses(environmentId: string) {
  const environmentInstances = await db.select().from(instances)
    .where(eq(instances.environmentId, environmentId));

  const environmentData = await db.select().from(environments)
    .where(eq(environments.id, environmentId))
    .limit(1);

  if (!environmentData.length) {
    throw new Error(`Environment not found: ${environmentId}`);
  }

  const environment = environmentData[0];

  // Check if Standard env uses Enterprise-only features → must license as Enterprise
  let usesEnterpriseFeatures = false;
  if (environment.edition.includes('Standard')) {
    const rawFeaturesInUse = await db.select().from(featureStats)
      .where(and(
        eq(featureStats.environmentId, environmentId),
        eq(featureStats.currentlyUsed, true)
      ));
    const featuresInUse = filterComplianceRelevantFeatureUsage(rawFeaturesInUse);

    if (featuresInUse.length > 0) {
      const enterpriseProducts = await db.select().from(intLicenseProducts)
        .where(eq(intLicenseProducts.onlyEnterprise, true));
      const enterpriseOnlyNames = new Set(enterpriseProducts.map(p => p.product));
      usesEnterpriseFeatures = featuresInUse.some(f => enterpriseOnlyNames.has(f.name));
    }
  }

  const isStandard = environment.edition.includes('Standard') && !usesEnterpriseFeatures;

  if (environment.isDataGuard) {
    return {
      totalProcessorLicenses: 0,
      totalCores: 0,
      totalPhysicalCores: 0,
      averageCoreFactor: 0,
      calculationDetails: [{ note: 'Data Guard standby environment - no processor licenses required' }]
    };
  }

  let totalProcessorLicenses = 0;
  let totalCores = 0;
  let totalPhysicalCores = 0;
  let totalCoreFactor = 0;
  const calculationDetails: any[] = [];
  const processedPhysicalHosts = new Set<string>();

  for (const instance of environmentInstances) {
    const hostData = await db.select().from(hosts)
      .where(eq(hosts.id, instance.hostId))
      .limit(1);

    if (!hostData.length) {
      throw new Error(`Host not found for instance: ${instance.id}`);
    }

    const host = hostData[0];
    let coreCount = 0;
    let socketCount = host.sockets || 1;
    let effectiveCoreFactor = host.coreFactor;

    if (host.serverType === 'Physical') {
      if (processedPhysicalHosts.has(host.id)) {
        calculationDetails.push({
          instanceId: instance.id, instanceName: instance.name,
          hostId: host.id, hostName: host.name, serverType: host.serverType,
          cores: 0, sockets: 0, coreFactor: effectiveCoreFactor, processorLicenses: 0,
          hasHardPartitioning: host.hasHardPartitioning, physicalHostId: host.physicalHostId,
          note: 'Physical host already counted (deduplication)'
        });
        continue;
      }
      processedPhysicalHosts.add(host.id);
      coreCount = host.cores;
      socketCount = host.sockets;
      totalPhysicalCores += coreCount;
    } else if (host.serverType === 'Virtual') {
      if (host.hasHardPartitioning) {
        const coreAssignmentCount = await db.select({ count: sql`count(*)` }).from(coreAssignments)
          .where(eq(coreAssignments.hostId, host.id));
        coreCount = Number(coreAssignmentCount[0].count);
      } else if (host.physicalHostId) {
        if (processedPhysicalHosts.has(host.physicalHostId)) {
          calculationDetails.push({
            instanceId: instance.id, instanceName: instance.name,
            hostId: host.id, hostName: host.name, serverType: host.serverType,
            cores: 0, sockets: 0, coreFactor: effectiveCoreFactor, processorLicenses: 0,
            hasHardPartitioning: host.hasHardPartitioning, physicalHostId: host.physicalHostId,
            note: 'Physical host already counted (deduplication)'
          });
          continue;
        }
        processedPhysicalHosts.add(host.physicalHostId);

        const physicalHostData = await db.select().from(hosts)
          .where(eq(hosts.id, host.physicalHostId))
          .limit(1);

        if (physicalHostData.length) {
          const physicalHost = physicalHostData[0];
          coreCount = physicalHost.cores;
          socketCount = physicalHost.sockets;
          effectiveCoreFactor = physicalHost.coreFactor;
          totalPhysicalCores += coreCount;
        } else {
          coreCount = host.cores;
        }
      } else {
        coreCount = host.cores;
      }
    } else if (host.serverType === 'Oracle Cloud') {
      coreCount = host.cores;
      socketCount = 1;
    }

    let instanceLicenses: number;
    if (isStandard) {
      instanceLicenses = Math.min(socketCount, 2);
    } else {
      instanceLicenses = coreCount * effectiveCoreFactor;
    }
    totalProcessorLicenses += instanceLicenses;
    totalCores += coreCount;
    totalCoreFactor += (coreCount * effectiveCoreFactor);

    calculationDetails.push({
      instanceId: instance.id, instanceName: instance.name,
      hostId: host.id, hostName: host.name, serverType: host.serverType,
      cores: coreCount, sockets: socketCount, coreFactor: effectiveCoreFactor,
      processorLicenses: instanceLicenses,
      hasHardPartitioning: host.hasHardPartitioning, physicalHostId: host.physicalHostId,
      licensingModel: isStandard ? 'Socket-based (SE2)' : 'Core Factor (EE)'
    });
  }

  return {
    totalProcessorLicenses,
    totalCores,
    totalPhysicalCores,
    averageCoreFactor: totalCores > 0 ? totalCoreFactor / totalCores : 0,
    calculationDetails
  };
}

// ─── Available Processor Licenses ────────────────────────────────────────────

export async function getAvailableProcessorLicenses(environmentId: string, customerId: string) {
  const environmentData = await db.select().from(environments)
    .where(eq(environments.id, environmentId))
    .limit(1);

  if (!environmentData.length) {
    throw new Error(`Environment not found: ${environmentId}`);
  }

  const environment = environmentData[0];
  let licenseQuery;

  if (environment.edition.includes('Standard')) {
    licenseQuery = and(
      eq(licenses.customerId, customerId),
      eq(licenses.metric, 'Processor'),
      like(licenses.product, `%Oracle Database%`),
      or(like(licenses.edition, `%Standard%`), like(licenses.edition, `%Enterprise%`))
    );
  } else if (environment.edition.includes('Enterprise')) {
    licenseQuery = and(
      eq(licenses.customerId, customerId),
      eq(licenses.metric, 'Processor'),
      like(licenses.product, `%Oracle Database%`),
      like(licenses.edition, `%Enterprise%`)
    );
  } else {
    licenseQuery = and(
      eq(licenses.customerId, customerId),
      eq(licenses.metric, 'Processor'),
      like(licenses.product, `%Oracle Database%`),
      like(licenses.edition, `%${environment.edition}%`)
    );
  }

  const licenseData = await db.select().from(licenses).where(licenseQuery);
  let availableLicenses = 0;
  for (const license of licenseData) {
    if (environment.edition.includes('Enterprise')) {
      if (license.edition?.includes('Enterprise')) availableLicenses += license.quantity;
    } else {
      availableLicenses += license.quantity;
    }
  }

  return { availableLicenses, licenses: licenseData };
}

// ─── NUP License Calculation ─────────────────────────────────────────────────

export async function calculateNUPLicenses(
  environmentId: string,
  existingProcessorCalculation?: { totalProcessorLicenses: number; totalCores: number }
) {
  const environmentData = await db.select().from(environments)
    .where(eq(environments.id, environmentId))
    .limit(1);

  if (!environmentData.length) {
    throw new Error(`Environment not found: ${environmentId}`);
  }

  const environment = environmentData[0];

  if (environment.isDataGuard) {
    return {
      nupRequired: 0,
      calculationDetails: {
        totalCores: 0, nupPerCore: 0, edition: environment.edition,
        isEnterprise: environment.edition.includes('Enterprise'),
        calculation: 'Data Guard standby environment - no NUP licenses required'
      }
    };
  }

  const processorCalculation = existingProcessorCalculation ?? await calculateProcessorLicenses(environmentId);
  let nupRequired = 0;
  let calculation = '';
  let nupPerCore = 0;
  let serverCount = 1;

  if (environment.edition.includes('Enterprise')) {
    nupPerCore = NUP_PER_PROCESSOR;
    nupRequired = processorCalculation.totalProcessorLicenses * NUP_PER_PROCESSOR;
    calculation = `Enterprise Edition: ${processorCalculation.totalProcessorLicenses} processor licenses × ${NUP_PER_PROCESSOR} NUP/processor = ${nupRequired} NUP licenses`;
  } else {
    nupPerCore = NUP_STANDARD_MINIMUM;
    const environmentInstances = await db.select().from(instances)
      .where(eq(instances.environmentId, environmentId));

    const licensingUnits = new Set<string>();
    for (const inst of environmentInstances) {
      const hostData = await db.select().from(hosts)
        .where(eq(hosts.id, inst.hostId))
        .limit(1);
      if (hostData.length) {
        const host = hostData[0];
        if (host.serverType === 'Virtual' && !host.hasHardPartitioning && host.physicalHostId) {
          licensingUnits.add(host.physicalHostId);
        } else {
          licensingUnits.add(host.id);
        }
      }
    }
    serverCount = Math.max(licensingUnits.size, 1);
    nupRequired = serverCount * NUP_STANDARD_MINIMUM;
    calculation = `Standard Edition: ${serverCount} servidor(es) × ${NUP_STANDARD_MINIMUM} NUP mínimo por servidor = ${nupRequired} NUP licenses`;
  }

  return {
    nupRequired,
    calculationDetails: {
      totalCores: processorCalculation.totalCores,
      nupPerCore, edition: environment.edition,
      isEnterprise: environment.edition.includes('Enterprise'),
      serverCount: !environment.edition.includes('Enterprise') ? serverCount : undefined,
      calculation
    }
  };
}

// ─── Available NUP Licenses ──────────────────────────────────────────────────

export async function getAvailableNUPLicenses(environmentId: string, customerId: string) {
  const environmentData = await db.select().from(environments)
    .where(eq(environments.id, environmentId))
    .limit(1);

  if (!environmentData.length) {
    throw new Error(`Environment not found: ${environmentId}`);
  }

  const environment = environmentData[0];
  let licenseQuery;

  if (environment.edition.includes('Standard')) {
    licenseQuery = and(
      eq(licenses.customerId, customerId),
      eq(licenses.metric, 'Named User Plus'),
      like(licenses.product, `%Oracle Database%`),
      or(like(licenses.edition, `%Standard%`), like(licenses.edition, `%Enterprise%`))
    );
  } else if (environment.edition.includes('Enterprise')) {
    licenseQuery = and(
      eq(licenses.customerId, customerId),
      eq(licenses.metric, 'Named User Plus'),
      like(licenses.product, `%Oracle Database%`),
      like(licenses.edition, `%Enterprise%`)
    );
  } else {
    licenseQuery = and(
      eq(licenses.customerId, customerId),
      eq(licenses.metric, 'Named User Plus'),
      like(licenses.product, `%Oracle Database%`),
      like(licenses.edition, `%${environment.edition}%`)
    );
  }

  const licenseData = await db.select().from(licenses).where(licenseQuery);
  let availableNUPs = 0;
  for (const license of licenseData) {
    if (environment.edition.includes('Enterprise')) {
      if (license.edition?.includes('Enterprise')) availableNUPs += license.quantity;
    } else {
      availableNUPs += license.quantity;
    }
  }

  return { availableNUPs, licenses: licenseData };
}

// ─── Feature Compliance Analysis ─────────────────────────────────────────────

export async function analyzeFeatureCompliance(environmentId: string, customerId: string) {
  const environmentData = await db.select().from(environments)
    .where(eq(environments.id, environmentId))
    .limit(1);

  if (!environmentData.length) {
    throw new Error(`Environment not found: ${environmentId}`);
  }

  const environment = environmentData[0];
  const rawFeaturesInUse = await db.select().from(featureStats)
    .where(and(
      eq(featureStats.environmentId, environmentId),
      eq(featureStats.currentlyUsed, true)
    ));
  const featuresInUse = filterComplianceRelevantFeatureUsage(rawFeaturesInUse);

  const licenseProductsData = await db.select().from(intLicenseProducts);
  const licenseProductMap = new Map(licenseProductsData.map(p => [p.product, p]));

  // Get ALL available licenses for this customer (not filtered by metric,
  // since Feature/Option Pack licenses use Processor or NUP as their metric)
  const allCustomerLicenses = await db.select().from(licenses)
    .where(eq(licenses.customerId, customerId));

  // Build a map of feature/option pack licenses by matching license.product
  // against the product catalog entries that are Features or Option Packs
  const featureProductNames = new Set(
    licenseProductsData
      .filter(p => p.type === 'Feature' || p.type === 'Option Pack')
      .map(p => p.product)
  );
  const availableLicenseMap = new Map<string, typeof allCustomerLicenses[0]>();
  allCustomerLicenses.forEach(l => {
    if (featureProductNames.has(l.product)) {
      availableLicenseMap.set(l.product, l);
    }
  });

  const featureIssues = [];

  for (const feature of featuresInUse) {
    const licenseProduct = licenseProductMap.get(feature.name);
    if (!licenseProduct) continue;

    let isCompliant = true;
    let issueDescription = '';
    let applicableLicense = null;

    if (licenseProduct.onlyEnterprise === true && !environment.edition.includes('Enterprise')) {
      isCompliant = false;
      issueDescription = `Feature '${feature.name}' requires Enterprise Edition but environment is using ${environment.edition}`;
    }

    if (licenseProduct.type === 'Feature' || licenseProduct.type === 'Option Pack') {
      const license = availableLicenseMap.get(feature.name);
      if (!license) {
        isCompliant = false;
        issueDescription = `No license found for ${licenseProduct.type} '${feature.name}'`;
      } else {
        applicableLicense = license;
      }
    }

    if (!isCompliant) {
      featureIssues.push({
        featureName: feature.name,
        featureType: licenseProduct.type || 'Unknown',
        status: 'non-compliant',
        issueDescription,
        isLicensed: !!applicableLicense,
        licenseId: applicableLicense?.id
      });
    }
  }

  return featureIssues;
}

// ─── Host Licensing Details ──────────────────────────────────────────────────

export async function generateHostLicensingDetails(environmentId: string, customerId: string) {
  const environmentData = await db.select().from(environments)
    .where(eq(environments.id, environmentId))
    .limit(1);
  const isStandard = environmentData.length > 0 && environmentData[0].edition.includes('Standard');

  // Determine effective edition (Standard env using Enterprise features → Enterprise licensing)
  let effectiveEdition = environmentData.length > 0 ? environmentData[0].edition : 'Enterprise';
  if (isStandard) {
    const rawFeaturesInUse = await db.select().from(featureStats)
      .where(and(
        eq(featureStats.environmentId, environmentId),
        eq(featureStats.currentlyUsed, true)
      ));
    const featuresInUse = filterComplianceRelevantFeatureUsage(rawFeaturesInUse);

    if (featuresInUse.length > 0) {
      const enterpriseProducts = await db.select().from(intLicenseProducts)
        .where(eq(intLicenseProducts.onlyEnterprise, true));
      const enterpriseOnlyNames = new Set(enterpriseProducts.map(p => p.product));
      if (featuresInUse.some(f => enterpriseOnlyNames.has(f.name))) {
        effectiveEdition = 'Enterprise';
      }
    }
  }

  const environmentInstances = await db.select().from(instances)
    .where(eq(instances.environmentId, environmentId));

  const hostDetails = [];
  const processedHosts = new Set<string>();
  const processedPhysicalHosts = new Set<string>();

  for (const instance of environmentInstances) {
    if (processedHosts.has(instance.hostId)) continue;
    processedHosts.add(instance.hostId);

    const hostData = await db.select().from(hosts)
      .where(eq(hosts.id, instance.hostId))
      .limit(1);

    if (!hostData.length) continue;

    const host = hostData[0];
    let hostToCheckForLicenses = host.id;
    if (host.serverType === 'Virtual' && !host.hasHardPartitioning && host.physicalHostId) {
      hostToCheckForLicenses = host.physicalHostId;
    }

    const hostCoreAssignments = await db.select({
      coreAssignment: coreAssignments,
      licenseMapping: coreLicenseMappings,
      license: licenses
    })
    .from(coreAssignments)
    .leftJoin(coreLicenseMappings, eq(coreAssignments.id, coreLicenseMappings.coreAssignmentId))
    .leftJoin(licenses, eq(coreLicenseMappings.licenseId, licenses.id))
    .where(eq(coreAssignments.hostId, hostToCheckForLicenses));

    const licensedCoreIds = new Set<number>();
    const allCoreIds = new Set<number>();

    hostCoreAssignments.forEach(a => {
      allCoreIds.add(a.coreAssignment.coreId);
      if (a.licenseMapping?.licenseId && a.license?.edition) {
        // Only count as licensed if the license edition matches the environment's effective edition
        const licEdition = a.license.edition;
        if (effectiveEdition.includes('Enterprise')) {
          // Enterprise environments require Enterprise licenses
          if (licEdition.includes('Enterprise')) {
            licensedCoreIds.add(a.coreAssignment.coreId);
          }
        } else {
          // Standard environments accept Standard or Enterprise licenses
          if (licEdition.includes('Standard') || licEdition.includes('Enterprise')) {
            licensedCoreIds.add(a.coreAssignment.coreId);
          }
        }
      }
    });

    let totalCores = host.cores;
    let physicalCores: number | null = null;
    let licensingHostId = host.id;
    let licensingHostName = host.name;

    if (host.serverType === 'Physical') {
      if (processedPhysicalHosts.has(host.id)) continue;
      processedPhysicalHosts.add(host.id);
      physicalCores = host.cores;
    } else if (host.serverType === 'Virtual' && host.hasHardPartitioning) {
      totalCores = Math.max(allCoreIds.size, 1);
    } else if (host.serverType === 'Virtual' && host.physicalHostId) {
      if (processedPhysicalHosts.has(host.physicalHostId)) continue;
      processedPhysicalHosts.add(host.physicalHostId);

      const physicalHostData = await db.select().from(hosts)
        .where(eq(hosts.id, host.physicalHostId))
        .limit(1);

      if (physicalHostData.length) {
        licensingHostId = physicalHostData[0].id;
        licensingHostName = physicalHostData[0].name;
        physicalCores = physicalHostData[0].cores;
        totalCores = physicalCores;
      }
    }

    const licensedCores = licensedCoreIds.size;
    const unlicensedCores = Math.max(0, totalCores - licensedCores);

    let licenseStatus = 'compliant';
    if (unlicensedCores > 0) {
      licenseStatus = licensedCores === 0 ? 'non-compliant' : 'partial';
    }

    hostDetails.push({
      hostId: host.id, hostName: host.name, serverType: host.serverType,
      cores: totalCores, physicalCores, coreFactor: host.coreFactor,
      processorLicenses: isStandard ? Math.min(host.sockets || 1, 2) : totalCores * host.coreFactor,
      hasHardPartitioning: host.hasHardPartitioning || false,
      physicalHostId: host.physicalHostId,
      licensingHostId, licensingHostName,
      licensedCores, unlicensedCores, licenseStatus
    });
  }

  return hostDetails;
}

// ─── Full Environment Compliance Analysis ────────────────────────────────────

export async function analyzeEnvironmentCompliance(environmentId: string, customerId: string) {
  const environmentData = await db.select().from(environments)
    .where(and(eq(environments.id, environmentId), eq(environments.customerId, customerId)))
    .limit(1);

  if (!environmentData.length) {
    throw new Error(`Environment not found or does not belong to customer: ${environmentId}`);
  }

  const environment = environmentData[0];
  const warnings: string[] = [];

  const environmentInstances = await db.select().from(instances)
    .where(eq(instances.environmentId, environmentId));
  const hasInstances = environmentInstances.length > 0;

  if (!hasInstances) {
    warnings.push('Environment has no instances — compliance cannot be fully evaluated. Add instances to link this environment to its hosts.');
  }

  const processorCalculation = await calculateProcessorLicenses(environmentId);
  const processorLicenses = await getAvailableProcessorLicenses(environmentId, customerId);
  const processorVariance = processorLicenses.availableLicenses - processorCalculation.totalProcessorLicenses;

  const nupCalculation = await calculateNUPLicenses(environmentId, processorCalculation);
  const nupLicenses = await getAvailableNUPLicenses(environmentId, customerId);
  const nupVariance = nupLicenses.availableNUPs - nupCalculation.nupRequired;

  const featureIssues = await analyzeFeatureCompliance(environmentId, customerId);
  const hostDetails = await generateHostLicensingDetails(environmentId, customerId);

  // Check if ALL cores are covered via core assignments (important for soft partitioning)
  const allCoresLicensedViaAssignments = hostDetails.length > 0 && hostDetails.every(h => h.unlicensedCores === 0);

  // Pool-based check (license records) OR core-assignment-based check
  const processorOk = (processorLicenses.availableLicenses > 0 && processorVariance >= 0) ||
                      allCoresLicensedViaAssignments;
  const nupOk = nupLicenses.availableNUPs > 0 && nupVariance >= 0;
  let status = 'compliant';

  if (!hasInstances) {
    status = 'warning';
  } else if (!processorOk && !nupOk) {
    status = 'non-compliant';
  }
  if (featureIssues.length > 0) {
    status = 'non-compliant';
  }

  return {
    environmentId, status, warnings,
    processorLicensesRequired: processorCalculation.totalProcessorLicenses,
    processorLicensesAvailable: processorLicenses.availableLicenses,
    processorLicensesVariance: processorVariance,
    nupLicensesRequired: nupCalculation.nupRequired,
    nupLicensesAvailable: nupLicenses.availableNUPs,
    nupLicensesVariance: nupVariance,
    totalCores: processorCalculation.totalCores,
    totalPhysicalCores: processorCalculation.totalPhysicalCores,
    coreFactor: processorCalculation.averageCoreFactor,
    processorCalculationDetails: JSON.stringify(processorCalculation.calculationDetails),
    nupCalculationDetails: JSON.stringify(nupCalculation.calculationDetails),
    featureIssues, hostDetails
  };
}

// ─── Effective Edition (accounts for Enterprise features on Standard envs) ──

export async function getEffectiveEdition(envId: string, envEdition: string, featureUsage: { name: string }[]) {
  if (!envEdition.includes('Standard')) return envEdition;

  const relevantFeatureUsage = filterComplianceRelevantFeatureUsage(featureUsage);
  const enterpriseProducts = await db.select().from(intLicenseProducts)
    .where(eq(intLicenseProducts.onlyEnterprise, true));
  const enterpriseOnlyNames = new Set(enterpriseProducts.map(p => p.product));
  const usesEnterprise = relevantFeatureUsage.some(f => enterpriseOnlyNames.has(f.name));
  return usesEnterprise ? 'Enterprise' : envEdition;
}

// ─── Cross-Environment Shared Host Detection ────────────────────────────────

export async function detectSharedHostGroups(environmentsData: Array<{ id: string; name: string; edition: string; instances: any[] }>) {
  const hostToEnvironments = new Map<string, {
    envIds: string[]; envNames: string[]; physicalHostName: string;
    cores: number; coreFactor: number; edition: string;
  }>();

  for (const env of environmentsData) {
    for (const inst of env.instances) {
      const hostData = await db.select().from(hosts)
        .where(eq(hosts.id, inst.hostId))
        .limit(1);
      if (!hostData.length) continue;
      const host = hostData[0];

      let physicalHostId: string;
      let physicalHostName: string;
      let physicalCores: number;
      let physicalCoreFactor: number;

      if (host.serverType === 'Physical') {
        physicalHostId = host.id;
        physicalHostName = host.name;
        physicalCores = host.cores;
        physicalCoreFactor = host.coreFactor;
      } else if (host.serverType === 'Virtual' && !host.hasHardPartitioning && host.physicalHostId) {
        const physHost = await db.select().from(hosts)
          .where(eq(hosts.id, host.physicalHostId))
          .limit(1);
        if (!physHost.length) continue;
        physicalHostId = physHost[0].id;
        physicalHostName = physHost[0].name;
        physicalCores = physHost[0].cores;
        physicalCoreFactor = physHost[0].coreFactor;
      } else {
        continue;
      }

      if (!hostToEnvironments.has(physicalHostId)) {
        hostToEnvironments.set(physicalHostId, {
          envIds: [], envNames: [], physicalHostName,
          cores: physicalCores, coreFactor: physicalCoreFactor, edition: env.edition
        });
      }

      const entry = hostToEnvironments.get(physicalHostId)!;
      if (!entry.envIds.includes(env.id)) {
        entry.envIds.push(env.id);
        entry.envNames.push(env.name);
      }
    }
  }

  const sharedHostGroups: Array<{
    physicalHostId: string; physicalHostName: string;
    cores: number; coreFactor: number; sharedProcessorLicenses: number;
    environmentIds: string[]; environmentNames: string[];
  }> = [];

  hostToEnvironments.forEach((info, physHostId) => {
    if (info.envIds.length > 1) {
      const isStandard = info.edition.includes('Standard');
      const sharedLicenses = isStandard ? Math.min(2, 1) : info.cores * info.coreFactor;

      sharedHostGroups.push({
        physicalHostId: physHostId,
        physicalHostName: info.physicalHostName,
        cores: info.cores, coreFactor: info.coreFactor,
        sharedProcessorLicenses: sharedLicenses,
        environmentIds: info.envIds, environmentNames: info.envNames
      });
    }
  });

  return sharedHostGroups;
}

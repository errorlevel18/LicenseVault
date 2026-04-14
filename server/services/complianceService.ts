import db from '../database';
import logger from '../utils/logger';
import {
  environments, instances, hosts, featureStats, licenses, coreAssignments,
  coreLicenseMappings, intLicenseProducts, pdbs
} from '../../shared/schema';
import { and, eq, like, ne, or, sql } from 'drizzle-orm';

// ─── Constants ───────────────────────────────────────────────────────────────

export const NUP_PER_PROCESSOR = 25;
export const NUP_STANDARD_MINIMUM = 10;

/** Technologies Oracle recognises as hard partitioning (case-insensitive match). */
const APPROVED_HARD_PARTITIONING: ReadonlySet<string> = new Set([
  'ovm',            // Oracle VM
  'ol kvm',         // Oracle Linux KVM (since Oct 2019)
  'oracle linux kvm',
  'ldom',           // Solaris Logical Domains
  'solaris zones',  // Solaris Containers / Zones (capped CPU)
  'lpar',           // IBM LPAR with static processor assignment
]);

const SYSTEM_MANAGED_FEATURE_SUFFIX = /\s*\(system\)\s*$/i;

// Products Oracle made free (no license required)
const FREE_PRODUCTS = new Set([
  'Spatial and Graph',
  'Advanced Analytics', // Oracle Machine Learning — free since 2019
]);

// ─── Public helpers (re-exported for backward compat) ────────────────────────

export function isSystemManagedFeatureName(featureName: string) {
  return SYSTEM_MANAGED_FEATURE_SUFFIX.test(featureName.trim());
}

export function filterComplianceRelevantFeatureUsage<T extends { name: string }>(
  featureUsage: T[]
) {
  return featureUsage.filter((f) => !isSystemManagedFeatureName(f.name));
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LicensingUnit {
  licensingHostId: string;
  licensingHostName: string;
  cores: number;
  sockets: number;
  coreFactor: number;
  serverType: string;
  virtualizationType: string | null;
  hasHardPartitioning: boolean;
  hardPartitioningValid: boolean;
  physicalHostId: string | null;
  environmentIds: string[];
  environmentNames: string[];
  editions: string[];
  effectiveEdition: string;
  productsInUse: string[];
  processorDemand: number;
  nupMinimumDemand: number;
  licensedCores: number;
  unlicensedCores: number;
  licenseStatus: string;
}

export interface ProductDemand {
  product: string;
  edition: string;
  totalProcessorDemand: number;
  totalNupDemand: number;
  processorAvailable: number;
  nupAvailable: number;
  processorVariance: number;
  nupVariance: number;
  processorOk: boolean;
  nupOk: boolean;
  covered: boolean;
}

export interface ComplianceAlert {
  severity: 'error' | 'warning' | 'info';
  environmentId?: string;
  environmentName?: string;
  hostId?: string;
  hostName?: string;
  message: string;
  category: string;
}

interface FeatureIssue {
  featureName: string;
  featureType: string;
  status: string;
  issueDescription: string;
  isLicensed: boolean;
  licenseId?: string;
}

// ─── Internal: build the oracle-feature-name → product mapping ───────────────

async function loadFeatureProductMap() {
  const licenseProductsData = await db.select().from(intLicenseProducts);
  const map = new Map<string, typeof licenseProductsData[0]>();
  const enterpriseOnly = new Set<string>();
  for (const lp of licenseProductsData) {
    map.set(lp.product, lp);
    if (lp.onlyEnterprise) enterpriseOnly.add(lp.product);
    if (lp.oracleFeatureNames) {
      try {
        const names: string[] = JSON.parse(lp.oracleFeatureNames);
        for (const n of names) map.set(n, lp);
      } catch { /* ignore bad JSON */ }
    }
  }
  return { map, enterpriseOnly, raw: licenseProductsData };
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 1 — Build Licensing Units
// ═════════════════════════════════════════════════════════════════════════════

async function buildLicensingUnits(customerId: string, environmentIds?: string[]): Promise<{
  units: Map<string, LicensingUnit>;
  alerts: ComplianceAlert[];
  /** environments that have instances (were fully evaluated) */
  evaluatedEnvIds: Set<string>;
  /** environments with zero instances */
  skippedEnvIds: Set<string>;
}> {
  const alerts: ComplianceAlert[] = [];
  const evaluatedEnvIds = new Set<string>();
  const skippedEnvIds = new Set<string>();

  // Load all licensable environments
  const allEnvironments = await db.select().from(environments)
    .where(and(eq(environments.customerId, customerId), ne(environments.licensable, false)));
  const targetEnvironments = environmentIds
    ? allEnvironments.filter(e => environmentIds.includes(e.id))
    : allEnvironments;

  const { map: featureNameToProduct, enterpriseOnly } = await loadFeatureProductMap();

  const units = new Map<string, LicensingUnit>();

  for (const env of targetEnvironments) {
    // ── instances ──
    const envInstances = await db.select().from(instances)
      .where(eq(instances.environmentId, env.id));

    if (envInstances.length === 0) {
      skippedEnvIds.add(env.id);
      alerts.push({
        severity: 'warning', environmentId: env.id, environmentName: env.name,
        message: 'Environment has no instances — compliance cannot be fully evaluated. Add instances to link this environment to its hosts.',
        category: 'no-instances',
      });
      continue;
    }
    evaluatedEnvIds.add(env.id);

    // ── feature usage ──
    const allFeatures = await db.select().from(featureStats)
      .where(eq(featureStats.environmentId, env.id));
    const activeFeatures = allFeatures.filter(f => f.currentlyUsed === true);
    const relevantActive = filterComplianceRelevantFeatureUsage(activeFeatures);

    // Historical usage warnings
    for (const feat of allFeatures) {
      if (!feat.currentlyUsed && feat.detectedUsages && feat.detectedUsages > 0) {
        const product = featureNameToProduct.get(feat.name);
        if (product && !FREE_PRODUCTS.has(product.product) && !isSystemManagedFeatureName(feat.name)) {
          alerts.push({
            severity: 'warning', environmentId: env.id, environmentName: env.name,
            message: `Feature "${feat.name}" has historical usage (${feat.detectedUsages} detections, last: ${feat.lastUsageDate || 'unknown'}). Oracle may claim retroactive licensing.`,
            category: 'historical-usage',
          });
        }
      }
    }

    // ── products in use ──
    const envProducts = new Set<string>();
    envProducts.add('Oracle Database');

    for (const feat of relevantActive) {
      const product = featureNameToProduct.get(feat.name);
      if (product && !FREE_PRODUCTS.has(product.product)) {
        envProducts.add(product.product);
      }
    }
    // Tuning → Diagnostics dependency
    if (envProducts.has('Tuning')) envProducts.add('Diagnostics');

    // ── edition escalation ──
    let envEffectiveEdition = env.edition;
    if (env.edition.includes('Standard')) {
      const usesEE = relevantActive.some(f => {
        const p = featureNameToProduct.get(f.name);
        return p && enterpriseOnly.has(p.product);
      });
      if (usesEE) {
        envEffectiveEdition = 'Enterprise';
        const eeNames = relevantActive
          .filter(f => { const p = featureNameToProduct.get(f.name); return p && enterpriseOnly.has(p.product); })
          .map(f => f.name);
        alerts.push({
          severity: 'error', environmentId: env.id, environmentName: env.name,
          message: `Standard Edition environment uses Enterprise-only features (${eeNames.join(', ')}). Enterprise Edition licensing is required.`,
          category: 'edition-escalation',
        });
      }
    }

    // ── Data Guard / Active Data Guard ──
    const usesActiveDataGuard = relevantActive.some(f => {
      const p = featureNameToProduct.get(f.name);
      return p && p.product === 'Active Data Guard';
    });

    if (env.isDataGuard && usesActiveDataGuard) {
      alerts.push({
        severity: 'error', environmentId: env.id, environmentName: env.name,
        message: 'Active Data Guard detected on standby. Requires Active Data Guard Option Pack license. The standby server also requires base Oracle Database licenses.',
        category: 'active-data-guard',
      });
    }

    // ── resolve each instance to its licensing unit ──
    for (const inst of envInstances) {
      const hostData = await db.select().from(hosts).where(eq(hosts.id, inst.hostId)).limit(1);
      if (!hostData.length) continue;
      const host = hostData[0];

      let luId: string, luName: string, luCores: number, luSockets: number;
      let luCoreFactor: number, luServerType: string, luVirtType: string | null;
      let luHasHard: boolean, hardValid = false, luPhysicalHostId: string | null;

      if (host.serverType === 'Physical') {
        luId = host.id; luName = host.name; luCores = host.cores;
        luSockets = host.sockets; luCoreFactor = host.coreFactor;
        luServerType = host.serverType; luVirtType = host.virtualizationType;
        luHasHard = false; luPhysicalHostId = host.physicalHostId;

      } else if (host.serverType === 'Virtual') {
        luHasHard = host.hasHardPartitioning || false;
        luVirtType = host.virtualizationType;
        luPhysicalHostId = host.physicalHostId;
        luServerType = host.serverType;

        // validate hard partitioning tech
        if (luHasHard) {
          const vt = (luVirtType || '').toLowerCase().trim();
          hardValid = Array.from(APPROVED_HARD_PARTITIONING).some(a => vt.includes(a));
          if (!hardValid) {
            alerts.push({
              severity: 'error', environmentId: env.id, environmentName: env.name,
              hostId: host.id, hostName: host.name,
              message: `Hard partitioning marked on "${host.name}" (${luVirtType || 'unknown'}), but Oracle does not recognise this technology. Full physical host must be licensed.`,
              category: 'invalid-hard-partitioning',
            });
          }
        }

        if (luHasHard && hardValid) {
          // valid hard partitioning → only assigned cores
          luId = host.id; luName = host.name;
          const cnt = await db.select({ count: sql`count(*)` })
            .from(coreAssignments).where(eq(coreAssignments.hostId, host.id));
          luCores = Number(cnt[0].count) || host.cores;
          luSockets = host.sockets; luCoreFactor = host.coreFactor;
        } else if (host.physicalHostId) {
          // soft partitioning → license the physical parent
          const ph = await db.select().from(hosts).where(eq(hosts.id, host.physicalHostId)).limit(1);
          if (ph.length) {
            luId = ph[0].id; luName = ph[0].name; luCores = ph[0].cores;
            luSockets = ph[0].sockets; luCoreFactor = ph[0].coreFactor;
            luServerType = ph[0].serverType;
            luVirtType = ph[0].virtualizationType;
            luPhysicalHostId = ph[0].physicalHostId;

            if ((host.virtualizationType || '').toLowerCase().includes('vmware')) {
              alerts.push({
                severity: 'warning', environmentId: env.id, environmentName: env.name,
                hostId: host.id, hostName: host.name,
                message: `VMware on "${host.name}". If vMotion is enabled, Oracle may require licensing ALL hosts in the vSphere cluster, not just "${ph[0].name}". Verify cluster scope.`,
                category: 'vmware-cluster',
              });
            }
          } else {
            luId = host.id; luName = host.name; luCores = host.cores;
            luSockets = host.sockets; luCoreFactor = host.coreFactor;
          }
        } else {
          luId = host.id; luName = host.name; luCores = host.cores;
          luSockets = host.sockets; luCoreFactor = host.coreFactor;
        }

      } else if (host.serverType === 'Oracle Cloud') {
        luId = host.id; luName = host.name; luCores = host.cores;
        luSockets = 1; luCoreFactor = host.coreFactor;
        luServerType = host.serverType; luVirtType = host.virtualizationType;
        luHasHard = false; luPhysicalHostId = host.physicalHostId;
      } else {
        luId = host.id; luName = host.name; luCores = host.cores;
        luSockets = host.sockets || 1; luCoreFactor = host.coreFactor;
        luServerType = host.serverType; luVirtType = host.virtualizationType;
        luHasHard = false; luPhysicalHostId = host.physicalHostId;
      }

      // merge into existing unit or create new
      const existing = units.get(luId);
      if (existing) {
        if (!existing.environmentIds.includes(env.id)) {
          existing.environmentIds.push(env.id);
          existing.environmentNames.push(env.name);
          existing.editions.push(envEffectiveEdition);
          for (const p of envProducts) {
            if (!existing.productsInUse.includes(p)) existing.productsInUse.push(p);
          }
        }
      } else {
        units.set(luId, {
          licensingHostId: luId, licensingHostName: luName,
          cores: luCores, sockets: luSockets, coreFactor: luCoreFactor,
          serverType: luServerType, virtualizationType: luVirtType,
          hasHardPartitioning: luHasHard, hardPartitioningValid: hardValid,
          physicalHostId: luPhysicalHostId,
          environmentIds: [env.id], environmentNames: [env.name],
          editions: [envEffectiveEdition],
          effectiveEdition: '', // resolved in Step 2
          productsInUse: Array.from(envProducts),
          processorDemand: 0, nupMinimumDemand: 0,
          licensedCores: 0, unlicensedCores: 0, licenseStatus: 'unknown',
        });
      }
    }
  }

  return { units, alerts, evaluatedEnvIds, skippedEnvIds };
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 2 — Effective edition per Licensing Unit
// ═════════════════════════════════════════════════════════════════════════════

function resolveEffectiveEditions(units: Map<string, LicensingUnit>, alerts: ComplianceAlert[]) {
  for (const unit of units.values()) {
    unit.effectiveEdition = unit.editions.some(e => e.includes('Enterprise'))
      ? 'Enterprise' : 'Standard';

    if (unit.effectiveEdition.includes('Standard') && unit.sockets > 2) {
      alerts.push({
        severity: 'error', hostId: unit.licensingHostId, hostName: unit.licensingHostName,
        message: `SE2 on "${unit.licensingHostName}" with ${unit.sockets} sockets. SE2 is limited to 2 sockets per server — contract violation.`,
        category: 'se2-socket-violation',
      });
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 3 — Processor demand per Licensing Unit
// ═════════════════════════════════════════════════════════════════════════════

function calculateProcessorDemands(
  units: Map<string, LicensingUnit>,
  envMap: Map<string, { isDataGuard: boolean | null; usesActiveDataGuard: boolean }>
) {
  for (const unit of units.values()) {
    // Pure DG standby (no Active Data Guard) on ALL envs → 0 demand
    const allPureDG = unit.environmentIds.every(id => {
      const info = envMap.get(id);
      return info && info.isDataGuard === true && !info.usesActiveDataGuard;
    });
    if (allPureDG) { unit.processorDemand = 0; continue; }

    unit.processorDemand = unit.effectiveEdition.includes('Standard')
      ? Math.min(unit.sockets, 2)
      : unit.cores * unit.coreFactor;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 4 — NUP demand per Licensing Unit
// ═════════════════════════════════════════════════════════════════════════════

function calculateNupDemands(units: Map<string, LicensingUnit>) {
  for (const unit of units.values()) {
    if (unit.processorDemand === 0) { unit.nupMinimumDemand = 0; continue; }
    unit.nupMinimumDemand = unit.effectiveEdition.includes('Enterprise')
      ? unit.processorDemand * NUP_PER_PROCESSOR
      : NUP_STANDARD_MINIMUM;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 5 — Validate special product rules
// ═════════════════════════════════════════════════════════════════════════════

async function validateProducts(units: Map<string, LicensingUnit>, alerts: ComplianceAlert[]) {
  for (const unit of units.values()) {
    // Multitenant ≤ 3 PDBs → free
    if (unit.productsInUse.includes('Multitenant')) {
      let allFewPDBs = true;
      for (const envId of unit.environmentIds) {
        const cnt = await db.select({ count: sql`count(*)` })
          .from(pdbs).where(eq(pdbs.environmentId, envId));
        if (Number(cnt[0]?.count || 0) > 3) { allFewPDBs = false; break; }
      }
      if (allFewPDBs) {
        unit.productsInUse = unit.productsInUse.filter(p => p !== 'Multitenant');
        alerts.push({
          severity: 'info', hostId: unit.licensingHostId, hostName: unit.licensingHostName,
          message: 'Multitenant with ≤ 3 PDBs — included free, no license required.',
          category: 'multitenant-free',
        });
      }
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 6 — Core-level license verification
// ═════════════════════════════════════════════════════════════════════════════

async function verifyCoreAssignments(units: Map<string, LicensingUnit>) {
  for (const unit of units.values()) {
    const rows = await db.select({
      coreAssignment: coreAssignments,
      licenseMapping: coreLicenseMappings,
      license: licenses,
    })
    .from(coreAssignments)
    .leftJoin(coreLicenseMappings, eq(coreAssignments.id, coreLicenseMappings.coreAssignmentId))
    .leftJoin(licenses, eq(coreLicenseMappings.licenseId, licenses.id))
    .where(eq(coreAssignments.hostId, unit.licensingHostId));

    const licensedCoreIds = new Set<number>();
    const allCoreIds = new Set<number>();

    for (const r of rows) {
      allCoreIds.add(r.coreAssignment.coreId);
      if (r.licenseMapping?.licenseId && r.license?.edition) {
        if (unit.effectiveEdition.includes('Enterprise')) {
          if (r.license.edition.includes('Enterprise')) licensedCoreIds.add(r.coreAssignment.coreId);
        } else {
          if (r.license.edition.includes('Standard') || r.license.edition.includes('Enterprise'))
            licensedCoreIds.add(r.coreAssignment.coreId);
        }
      }
    }

    unit.licensedCores = licensedCoreIds.size;
    unit.unlicensedCores = Math.max(0, unit.cores - unit.licensedCores);
    unit.licenseStatus = unit.unlicensedCores === 0 && unit.cores > 0
      ? 'compliant'
      : unit.licensedCores > 0 ? 'partial' : unit.cores > 0 ? 'non-compliant' : 'unknown';
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 7 — Product demand totals vs license pool
// ═════════════════════════════════════════════════════════════════════════════

async function calculateProductDemands(
  units: Map<string, LicensingUnit>, customerId: string
): Promise<ProductDemand[]> {
  const allProducts = new Set<string>();
  for (const u of units.values()) for (const p of u.productsInUse) allProducts.add(p);

  const allLicenses = await db.select().from(licenses).where(eq(licenses.customerId, customerId));
  const demands: ProductDemand[] = [];

  for (const product of allProducts) {
    let totalProc = 0, totalNup = 0;
    const editions = new Set<string>();
    for (const u of units.values()) {
      if (u.productsInUse.includes(product)) {
        totalProc += u.processorDemand;
        totalNup += u.nupMinimumDemand;
        editions.add(u.effectiveEdition);
      }
    }
    const highEdition = editions.has('Enterprise') ? 'Enterprise' : 'Standard';

    let procAvail = 0, nupAvail = 0;
    for (const lic of allLicenses) {
      let productMatch = product === 'Oracle Database'
        ? lic.product.includes('Oracle Database')
        : lic.product === product;
      if (!productMatch) continue;

      const le = lic.edition || '';
      let editionMatch = highEdition.includes('Enterprise')
        ? le.includes('Enterprise')
        : (le.includes('Standard') || le.includes('Enterprise'));
      if (product !== 'Oracle Database' && !lic.edition) editionMatch = true;
      if (!editionMatch) continue;

      if (lic.metric === 'Processor') procAvail += lic.quantity;
      else if (lic.metric === 'Named User Plus') nupAvail += lic.quantity;
    }

    const pv = procAvail - totalProc, nv = nupAvail - totalNup;
    const pOk = procAvail > 0 && pv >= 0, nOk = nupAvail > 0 && nv >= 0;
    demands.push({
      product, edition: highEdition,
      totalProcessorDemand: totalProc, totalNupDemand: totalNup,
      processorAvailable: procAvail, nupAvailable: nupAvail,
      processorVariance: pv, nupVariance: nv,
      processorOk: pOk, nupOk: nOk, covered: pOk || nOk,
    });
  }
  return demands;
}

// ═════════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR — Full compliance analysis (8 steps)
// ═════════════════════════════════════════════════════════════════════════════

export interface FullComplianceResult {
  licensingUnits: LicensingUnit[];
  productDemands: ProductDemand[];
  alerts: ComplianceAlert[];
  evaluatedEnvIds: string[];
  skippedEnvIds: string[];
}

export async function runFullComplianceAnalysis(
  customerId: string, environmentIds?: string[]
): Promise<FullComplianceResult> {
  // Step 1
  const { units, alerts, evaluatedEnvIds, skippedEnvIds } =
    await buildLicensingUnits(customerId, environmentIds);

  // Build env info map for Steps 3 & 5
  const { map: featureNameToProduct } = await loadFeatureProductMap();
  const envInfoMap = new Map<string, { isDataGuard: boolean | null; usesActiveDataGuard: boolean }>();

  for (const envId of evaluatedEnvIds) {
    const envData = await db.select().from(environments).where(eq(environments.id, envId)).limit(1);
    if (!envData.length) continue;
    const env = envData[0];

    const af = await db.select().from(featureStats)
      .where(and(eq(featureStats.environmentId, envId), eq(featureStats.currentlyUsed, true)));
    const usesADG = af.some(f => {
      const p = featureNameToProduct.get(f.name);
      return p && p.product === 'Active Data Guard';
    });

    envInfoMap.set(envId, { isDataGuard: env.isDataGuard, usesActiveDataGuard: usesADG });
  }

  // Step 2
  resolveEffectiveEditions(units, alerts);
  // Step 3
  calculateProcessorDemands(units, envInfoMap);
  // Step 4
  calculateNupDemands(units);
  // Step 5
  await validateProducts(units, alerts);
  // Step 6
  await verifyCoreAssignments(units);
  // Step 7
  const productDemands = await calculateProductDemands(units, customerId);

  // Step 8 — Generate summary alerts
  for (const d of productDemands) {
    if (!d.covered) {
      alerts.push({
        severity: 'error',
        message: `Insufficient licenses for "${d.product}" (${d.edition}): Processor demand=${d.totalProcessorDemand}, available=${d.processorAvailable} (variance: ${d.processorVariance}). NUP demand=${d.totalNupDemand}, available=${d.nupAvailable} (variance: ${d.nupVariance}).`,
        category: 'insufficient-licenses',
      });
    }
  }

  // SEHA info
  for (const unit of units.values()) {
    const envData = await db.select().from(environments)
      .where(eq(environments.customerId, customerId));
    const sehaEnvs = unit.environmentIds.filter(id => {
      const e = envData.find(env => env.id === id);
      return e && e.type === 'Oracle SEHA';
    });
    if (sehaEnvs.length > 0) {
      alerts.push({
        severity: 'info', hostId: unit.licensingHostId, hostName: unit.licensingHostName,
        message: 'SEHA detected. Failover node covered under 10-day rule (max 10 days/year). SE2 per-server 2-socket limit applies.',
        category: 'seha-info',
      });
    }
  }

  return {
    licensingUnits: Array.from(units.values()),
    productDemands, alerts,
    evaluatedEnvIds: Array.from(evaluatedEnvIds),
    skippedEnvIds: Array.from(skippedEnvIds),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// BACKWARD-COMPATIBLE WRAPPERS
// Keep the same public API so routes don't break.
// ═════════════════════════════════════════════════════════════════════════════

export async function analyzeEnvironmentCompliance(environmentId: string, customerId: string) {
  const envData = await db.select().from(environments)
    .where(and(eq(environments.id, environmentId), eq(environments.customerId, customerId)))
    .limit(1);
  if (!envData.length) throw new Error(`Environment not found or does not belong to customer: ${environmentId}`);
  const env = envData[0];

  const result = await runFullComplianceAnalysis(customerId, [environmentId]);

  const warnings: string[] = [];
  for (const a of result.alerts) {
    if (a.environmentId === environmentId || !a.environmentId)
      warnings.push(`[${a.severity.toUpperCase()}] ${a.message}`);
  }

  let totalProcessorRequired = 0, totalCores = 0, totalPhysicalCores = 0, totalCoreFactor = 0;
  const calculationDetails: any[] = [];

  for (const u of result.licensingUnits) {
    totalProcessorRequired += u.processorDemand;
    totalCores += u.cores;
    totalPhysicalCores += u.cores;
    totalCoreFactor += u.cores * u.coreFactor;
    calculationDetails.push({
      hostId: u.licensingHostId, hostName: u.licensingHostName,
      serverType: u.serverType, cores: u.cores, sockets: u.sockets,
      coreFactor: u.coreFactor, processorLicenses: u.processorDemand,
      hasHardPartitioning: u.hasHardPartitioning,
      hardPartitioningValid: u.hardPartitioningValid,
      physicalHostId: u.physicalHostId,
      licensingModel: u.effectiveEdition.includes('Standard') ? 'Socket-based (SE2)' : 'Core Factor (EE)',
      environmentNames: u.environmentNames,
    });
  }

  const avgCF = totalCores > 0 ? totalCoreFactor / totalCores : 0;
  const baseDemand = result.productDemands.find(d => d.product === 'Oracle Database');
  const procAvail = baseDemand?.processorAvailable ?? 0;
  const nupAvail = baseDemand?.nupAvailable ?? 0;

  let nupRequired = 0;
  for (const u of result.licensingUnits) nupRequired += u.nupMinimumDemand;

  const procVar = procAvail - totalProcessorRequired;
  const nupVar = nupAvail - nupRequired;

  const featureIssues = await analyzeFeatureCompliance(environmentId, customerId);
  const hostDetails = result.licensingUnits.map(u => ({
    hostId: u.licensingHostId, hostName: u.licensingHostName,
    serverType: u.serverType, cores: u.cores, physicalCores: u.cores,
    coreFactor: u.coreFactor, processorLicenses: u.processorDemand,
    hasHardPartitioning: u.hasHardPartitioning, physicalHostId: u.physicalHostId,
    licensingHostId: u.licensingHostId, licensingHostName: u.licensingHostName,
    licensedCores: u.licensedCores, unlicensedCores: u.unlicensedCores,
    licenseStatus: u.licenseStatus,
  }));

  const allCoresLicensed = hostDetails.length > 0 && hostDetails.every(h => h.unlicensedCores === 0);
  const instCnt = await db.select({ count: sql`count(*)` }).from(instances)
    .where(eq(instances.environmentId, environmentId));
  const hasInstances = Number(instCnt[0]?.count || 0) > 0;

  const procOk = (procAvail > 0 && procVar >= 0) || allCoresLicensed;
  const nupOk = nupAvail > 0 && nupVar >= 0;
  let status = 'compliant';
  if (!hasInstances) status = 'warning';
  else if (!procOk && !nupOk) status = 'non-compliant';
  if (featureIssues.length > 0) status = 'non-compliant';

  return {
    environmentId, status, warnings,
    processorLicensesRequired: totalProcessorRequired,
    processorLicensesAvailable: procAvail,
    processorLicensesVariance: procVar,
    nupLicensesRequired: nupRequired,
    nupLicensesAvailable: nupAvail,
    nupLicensesVariance: nupVar,
    totalCores, totalPhysicalCores,
    coreFactor: avgCF,
    processorCalculationDetails: JSON.stringify(calculationDetails),
    nupCalculationDetails: JSON.stringify({
      totalCores, edition: env.edition,
      isEnterprise: env.edition.includes('Enterprise'),
      calculation: env.edition.includes('Enterprise')
        ? `Enterprise: ${totalProcessorRequired} proc × ${NUP_PER_PROCESSOR} = ${nupRequired} NUP`
        : `Standard: ${result.licensingUnits.length} server(s) × ${NUP_STANDARD_MINIMUM} = ${nupRequired} NUP`,
    }),
    featureIssues, hostDetails,
  };
}

export async function calculateProcessorLicenses(environmentId: string) {
  const envData = await db.select().from(environments).where(eq(environments.id, environmentId)).limit(1);
  if (!envData.length) throw new Error(`Environment not found: ${environmentId}`);

  const result = await runFullComplianceAnalysis(envData[0].customerId, [environmentId]);

  let totalProc = 0, totalCores = 0, totalPhys = 0, totalCF = 0;
  const details: any[] = [];

  for (const u of result.licensingUnits) {
    totalProc += u.processorDemand; totalCores += u.cores; totalPhys += u.cores;
    totalCF += u.cores * u.coreFactor;
    details.push({
      hostId: u.licensingHostId, hostName: u.licensingHostName,
      serverType: u.serverType, cores: u.cores, sockets: u.sockets,
      coreFactor: u.coreFactor, processorLicenses: u.processorDemand,
      hasHardPartitioning: u.hasHardPartitioning, physicalHostId: u.physicalHostId,
      licensingModel: u.effectiveEdition.includes('Standard') ? 'Socket-based (SE2)' : 'Core Factor (EE)',
    });
  }

  return {
    totalProcessorLicenses: totalProc, totalCores, totalPhysicalCores: totalPhys,
    averageCoreFactor: totalCores > 0 ? totalCF / totalCores : 0,
    calculationDetails: details,
  };
}

export async function getAvailableProcessorLicenses(environmentId: string, customerId: string) {
  const envData = await db.select().from(environments).where(eq(environments.id, environmentId)).limit(1);
  if (!envData.length) throw new Error(`Environment not found: ${environmentId}`);
  const env = envData[0];

  let q;
  if (env.edition.includes('Standard')) {
    q = and(eq(licenses.customerId, customerId), eq(licenses.metric, 'Processor'),
      like(licenses.product, '%Oracle Database%'),
      or(like(licenses.edition, '%Standard%'), like(licenses.edition, '%Enterprise%')));
  } else if (env.edition.includes('Enterprise')) {
    q = and(eq(licenses.customerId, customerId), eq(licenses.metric, 'Processor'),
      like(licenses.product, '%Oracle Database%'), like(licenses.edition, '%Enterprise%'));
  } else {
    q = and(eq(licenses.customerId, customerId), eq(licenses.metric, 'Processor'),
      like(licenses.product, '%Oracle Database%'), like(licenses.edition, `%${env.edition}%`));
  }

  const data = await db.select().from(licenses).where(q);
  let avail = 0;
  for (const l of data) {
    if (env.edition.includes('Enterprise')) {
      if (l.edition?.includes('Enterprise')) avail += l.quantity;
    } else avail += l.quantity;
  }
  return { availableLicenses: avail, licenses: data };
}

export async function calculateNUPLicenses(
  environmentId: string,
  existingProcessorCalculation?: { totalProcessorLicenses: number; totalCores: number }
) {
  const envData = await db.select().from(environments).where(eq(environments.id, environmentId)).limit(1);
  if (!envData.length) throw new Error(`Environment not found: ${environmentId}`);
  const env = envData[0];

  // DG standby: check Active Data Guard
  if (env.isDataGuard) {
    const { map: fnMap } = await loadFeatureProductMap();
    const af = await db.select().from(featureStats)
      .where(and(eq(featureStats.environmentId, environmentId), eq(featureStats.currentlyUsed, true)));
    const usesADG = af.some(f => { const p = fnMap.get(f.name); return p && p.product === 'Active Data Guard'; });
    if (!usesADG) {
      return {
        nupRequired: 0,
        calculationDetails: {
          totalCores: 0, nupPerCore: 0, edition: env.edition,
          isEnterprise: env.edition.includes('Enterprise'),
          calculation: 'Data Guard standby (pure) — no NUP licenses required',
        },
      };
    }
  }

  const pc = existingProcessorCalculation ?? await calculateProcessorLicenses(environmentId);
  let nupReq = 0, calc = '', nupPer = 0, serverCount = 1;

  if (env.edition.includes('Enterprise')) {
    nupPer = NUP_PER_PROCESSOR;
    nupReq = pc.totalProcessorLicenses * NUP_PER_PROCESSOR;
    calc = `Enterprise: ${pc.totalProcessorLicenses} proc × ${NUP_PER_PROCESSOR} = ${nupReq} NUP`;
  } else {
    nupPer = NUP_STANDARD_MINIMUM;
    const ei = await db.select().from(instances).where(eq(instances.environmentId, environmentId));
    const lu = new Set<string>();
    for (const inst of ei) {
      const hd = await db.select().from(hosts).where(eq(hosts.id, inst.hostId)).limit(1);
      if (hd.length) {
        const h = hd[0];
        if (h.serverType === 'Virtual' && !h.hasHardPartitioning && h.physicalHostId)
          lu.add(h.physicalHostId);
        else lu.add(h.id);
      }
    }
    serverCount = Math.max(lu.size, 1);
    nupReq = serverCount * NUP_STANDARD_MINIMUM;
    calc = `Standard: ${serverCount} server(s) × ${NUP_STANDARD_MINIMUM} = ${nupReq} NUP`;
  }

  return {
    nupRequired: nupReq,
    calculationDetails: {
      totalCores: pc.totalCores, nupPerCore: nupPer, edition: env.edition,
      isEnterprise: env.edition.includes('Enterprise'),
      serverCount: !env.edition.includes('Enterprise') ? serverCount : undefined,
      calculation: calc,
    },
  };
}

export async function getAvailableNUPLicenses(environmentId: string, customerId: string) {
  const envData = await db.select().from(environments).where(eq(environments.id, environmentId)).limit(1);
  if (!envData.length) throw new Error(`Environment not found: ${environmentId}`);
  const env = envData[0];

  let q;
  if (env.edition.includes('Standard')) {
    q = and(eq(licenses.customerId, customerId), eq(licenses.metric, 'Named User Plus'),
      like(licenses.product, '%Oracle Database%'),
      or(like(licenses.edition, '%Standard%'), like(licenses.edition, '%Enterprise%')));
  } else if (env.edition.includes('Enterprise')) {
    q = and(eq(licenses.customerId, customerId), eq(licenses.metric, 'Named User Plus'),
      like(licenses.product, '%Oracle Database%'), like(licenses.edition, '%Enterprise%'));
  } else {
    q = and(eq(licenses.customerId, customerId), eq(licenses.metric, 'Named User Plus'),
      like(licenses.product, '%Oracle Database%'), like(licenses.edition, `%${env.edition}%`));
  }

  const data = await db.select().from(licenses).where(q);
  let avail = 0;
  for (const l of data) {
    if (env.edition.includes('Enterprise')) {
      if (l.edition?.includes('Enterprise')) avail += l.quantity;
    } else avail += l.quantity;
  }
  return { availableNUPs: avail, licenses: data };
}

export async function analyzeFeatureCompliance(environmentId: string, customerId: string) {
  const envData = await db.select().from(environments).where(eq(environments.id, environmentId)).limit(1);
  if (!envData.length) throw new Error(`Environment not found: ${environmentId}`);
  const env = envData[0];

  const rawFeatures = await db.select().from(featureStats)
    .where(and(eq(featureStats.environmentId, environmentId), eq(featureStats.currentlyUsed, true)));
  const featuresInUse = filterComplianceRelevantFeatureUsage(rawFeatures);

  const { map: fnMap, raw: catalog } = await loadFeatureProductMap();

  const allLicenses = await db.select().from(licenses).where(eq(licenses.customerId, customerId));
  const featureProductNames = new Set(catalog.filter(p => p.type === 'Feature' || p.type === 'Option Pack').map(p => p.product));
  const licMap = new Map<string, typeof allLicenses[0]>();
  allLicenses.forEach(l => { if (featureProductNames.has(l.product)) licMap.set(l.product, l); });

  const issues: FeatureIssue[] = [];
  const resolved = new Set<string>();

  // Tuning→Diagnostics
  const usedProducts = new Set<string>();
  for (const f of featuresInUse) { const p = fnMap.get(f.name); if (p) usedProducts.add(p.product); }
  if (usedProducts.has('Tuning') && !usedProducts.has('Diagnostics')) usedProducts.add('Diagnostics');

  for (const feat of featuresInUse) {
    const lp = fnMap.get(feat.name);
    if (!lp || resolved.has(lp.product) || FREE_PRODUCTS.has(lp.product)) continue;
    resolved.add(lp.product);

    let ok = true, desc = '', appLic = null;

    if (lp.onlyEnterprise === true && !env.edition.includes('Enterprise')) {
      ok = false;
      desc = `Feature '${lp.product}' requires Enterprise Edition but environment uses ${env.edition}`;
    }

    if (lp.type === 'Feature' || lp.type === 'Option Pack') {
      const lic = licMap.get(lp.product);
      if (!lic) {
        ok = false;
        desc = desc
          ? `${desc}. No license found for ${lp.type} '${lp.product}'`
          : `No license found for ${lp.type} '${lp.product}'`;
      } else appLic = lic;
    }

    if (!ok) {
      issues.push({
        featureName: lp.product, featureType: lp.type || 'Unknown',
        status: 'non-compliant', issueDescription: desc,
        isLicensed: !!appLic, licenseId: appLic?.id,
      });
    }
  }

  // Diagnostics dependency check
  if (usedProducts.has('Diagnostics') && !resolved.has('Diagnostics')) {
    if (!licMap.has('Diagnostics')) {
      issues.push({
        featureName: 'Diagnostics', featureType: 'Option Pack',
        status: 'non-compliant',
        issueDescription: 'Tuning Pack requires Diagnostics Pack, but no Diagnostics Pack license found',
        isLicensed: false,
      });
    }
  }

  return issues;
}

export async function generateHostLicensingDetails(environmentId: string, customerId: string) {
  const result = await runFullComplianceAnalysis(customerId, [environmentId]);
  return result.licensingUnits.map(u => ({
    hostId: u.licensingHostId, hostName: u.licensingHostName,
    serverType: u.serverType, cores: u.cores, physicalCores: u.cores,
    coreFactor: u.coreFactor, processorLicenses: u.processorDemand,
    hasHardPartitioning: u.hasHardPartitioning, physicalHostId: u.physicalHostId,
    licensingHostId: u.licensingHostId, licensingHostName: u.licensingHostName,
    licensedCores: u.licensedCores, unlicensedCores: u.unlicensedCores,
    licenseStatus: u.licenseStatus,
  }));
}

export async function getEffectiveEdition(
  envId: string, envEdition: string, featureUsage: { name: string }[]
) {
  if (!envEdition.includes('Standard')) return envEdition;
  const relevant = filterComplianceRelevantFeatureUsage(featureUsage);
  const { map: fnMap, enterpriseOnly } = await loadFeatureProductMap();
  return relevant.some(f => {
    const p = fnMap.get(f.name);
    return p && enterpriseOnly.has(p.product);
  }) ? 'Enterprise' : envEdition;
}

export async function detectSharedHostGroups(
  environmentsData: Array<{ id: string; name: string; edition: string; instances: any[] }>
) {
  const hte = new Map<string, {
    envIds: string[]; envNames: string[]; physicalHostName: string;
    cores: number; coreFactor: number; edition: string;
  }>();

  for (const env of environmentsData) {
    for (const inst of env.instances) {
      const hd = await db.select().from(hosts).where(eq(hosts.id, inst.hostId)).limit(1);
      if (!hd.length) continue;
      const h = hd[0];

      let pid: string, pn: string, pc: number, pcf: number;
      if (h.serverType === 'Physical') {
        pid = h.id; pn = h.name; pc = h.cores; pcf = h.coreFactor;
      } else if (h.serverType === 'Virtual' && !h.hasHardPartitioning && h.physicalHostId) {
        const ph = await db.select().from(hosts).where(eq(hosts.id, h.physicalHostId)).limit(1);
        if (!ph.length) continue;
        pid = ph[0].id; pn = ph[0].name; pc = ph[0].cores; pcf = ph[0].coreFactor;
      } else continue;

      if (!hte.has(pid)) {
        hte.set(pid, { envIds: [], envNames: [], physicalHostName: pn, cores: pc, coreFactor: pcf, edition: env.edition });
      }
      const e = hte.get(pid)!;
      if (!e.envIds.includes(env.id)) { e.envIds.push(env.id); e.envNames.push(env.name); }
    }
  }

  const groups: Array<{
    physicalHostId: string; physicalHostName: string;
    cores: number; coreFactor: number; sharedProcessorLicenses: number;
    environmentIds: string[]; environmentNames: string[];
  }> = [];

  hte.forEach((info, pid) => {
    if (info.envIds.length > 1) {
      const isSE = info.edition.includes('Standard');
      groups.push({
        physicalHostId: pid, physicalHostName: info.physicalHostName,
        cores: info.cores, coreFactor: info.coreFactor,
        sharedProcessorLicenses: isSE ? Math.min(2, 1) : info.cores * info.coreFactor,
        environmentIds: info.envIds, environmentNames: info.envNames,
      });
    }
  });

  return groups;
}

import { Router } from 'express';
import { z } from 'zod';
import db from '../database';
import { v4 as uuidv4 } from 'uuid';
import { safeOperation, withTransaction } from '../utils/error-handler';
import logger from '../utils/logger';
import { validateRequest } from '../middlewares/validationMiddleware';
import {
  environments, instances, hosts, featureStats, licenses,
  complianceRuns, complianceDetails, complianceHostDetails, complianceFeatureIssues,
  intLicenseProducts
} from '../../shared/schema';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  calculateProcessorLicenses,
  getAvailableProcessorLicenses,
  calculateNUPLicenses,
  getAvailableNUPLicenses,
  analyzeFeatureCompliance,
  generateHostLicensingDetails,
  analyzeEnvironmentCompliance,
  filterComplianceRelevantFeatureUsage,
  getEffectiveEdition,
  detectSharedHostGroups,
} from '../services/complianceService';

const router = Router();

// Schema for running a compliance analysis
const runComplianceSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({
    customerId: z.string().min(1, 'Customer ID is required'),
    environmentIds: z.array(z.string()).optional(), // Optional - if not provided, all environments for customer will be analyzed
  }),
});

// Schema for retrieving compliance results
const getComplianceResultsSchema = z.object({
  params: z.object({
    runId: z.string().min(1, 'Run ID is required'),
  }),
  body: z.object({}).optional(),
});

// Schema for retrieving environment compliance details
const getEnvironmentComplianceDetailsSchema = z.object({
  params: z.object({
    detailId: z.string().min(1, 'Detail ID is required'),
  }),
  body: z.object({}).optional(),
});

// Schema for erasing compliance analysis data for a customer
const eraseComplianceDataSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({
    customerId: z.string().min(1, 'Customer ID is required'),
  }),
});

// Matrix View Schema - New schema for the matrix view
const getMatrixViewSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({
    customerId: z.string().min(1, 'Customer ID is required'),
  }),
});

// All helper functions (calculateProcessorLicenses, getAvailableProcessorLicenses, etc.)
// have been extracted to ../services/complianceService.ts

// ─── Route Handlers ──────────────────────────────────────────────────────────

// Route to run a compliance analysis
router.post('/run', validateRequest(runComplianceSchema), async (req, res, next) => {
  const { customerId, environmentIds } = req.body;
    try {
  
  // IDOR protection: non-admin users can only run compliance for their own customer
  const user = req.user as any;
  if (user?.role !== 'admin' && customerId !== user.id) {
    return res.status(403).json({ error: 'Unauthorized access' });
  }
  
  // Start a transaction
  const result = await withTransaction(async (tx) => {
    // Create a new compliance run record
    const runId = uuidv4();
    
    // Create initial run record
    await tx.insert(complianceRuns).values({
      id: runId,
      customerId,
      status: 'in_progress',
      runDate: new Date().toISOString(),
    });
    
    // Get environments to analyze
    let environmentsToAnalyze;
    if (environmentIds && environmentIds.length > 0) {
      environmentsToAnalyze = await tx.select().from(environments)
        .where(
          and(
            eq(environments.customerId, customerId),
            inArray(environments.id, environmentIds),
            ne(environments.licensable, false)
          )
        );
    } else {
      environmentsToAnalyze = await tx.select().from(environments)
        .where(
          and(
            eq(environments.customerId, customerId),
            ne(environments.licensable, false)
          )
        );
    }
    
    // Analyze each environment
    const complianceResults = [];
    let compliantCount = 0;
    let nonCompliantCount = 0;
    let warningCount = 0;
    let unknownCount = 0;
    
    for (const environment of environmentsToAnalyze) {
      // Analyze environment
      const complianceResult = await analyzeEnvironmentCompliance(environment.id, customerId);
        // Create detail record
      const detailId = uuidv4();
      await tx.insert(complianceDetails).values({
        id: detailId,
        runId,
        environmentId: environment.id,
        feature: "N/A", // Añadir valor por defecto para el campo obligatorio
        edition: environment.edition, // Usar la edición del environment
        status: complianceResult.status,
        processorLicensesRequired: complianceResult.processorLicensesRequired,
        processorLicensesAvailable: complianceResult.processorLicensesAvailable,
        processorLicensesVariance: complianceResult.processorLicensesVariance,
        nupLicensesRequired: complianceResult.nupLicensesRequired,
        nupLicensesAvailable: complianceResult.nupLicensesAvailable,
        nupLicensesVariance: complianceResult.nupLicensesVariance,
        totalCores: complianceResult.totalCores,
        totalPhysicalCores: complianceResult.totalPhysicalCores,
        coreFactor: complianceResult.coreFactor,
        processorCalculationDetails: complianceResult.processorCalculationDetails,
        nupCalculationDetails: complianceResult.nupCalculationDetails
      });
      
      // Create structured host detail records
      if (complianceResult.hostDetails && Array.isArray(complianceResult.hostDetails)) {
        for (const hostDetail of complianceResult.hostDetails) {
          await tx.insert(complianceHostDetails).values({
            id: uuidv4(),
            complianceDetailId: detailId,
            hostId: hostDetail.hostId,
            hostName: hostDetail.hostName,
            serverType: hostDetail.serverType,
            totalCores: hostDetail.cores,
            physicalCores: hostDetail.physicalCores,
            coreFactor: hostDetail.coreFactor,
            processorLicensesRequired: hostDetail.processorLicenses,
            hasHardPartitioning: hostDetail.hasHardPartitioning || false,
            physicalHostId: hostDetail.physicalHostId,
            licensedCores: hostDetail.licensedCores || 0,
            unlicensedCores: hostDetail.unlicensedCores || 0,
            licenseStatus: hostDetail.licenseStatus || 'unknown'
          });
        }
      }
      
      // Create feature issue records
      for (const issue of complianceResult.featureIssues) {
        await tx.insert(complianceFeatureIssues).values({
          id: uuidv4(),
          complianceDetailId: detailId,
          featureName: issue.featureName,
          featureType: issue.featureType,
          status: issue.status,
          issueDescription: issue.issueDescription,
          isLicensed: issue.isLicensed,
          licenseId: issue.licenseId
        });
      }
      
      // Update counters based on status
      if (complianceResult.status === 'compliant') {
        compliantCount++;
      } else if (complianceResult.status === 'non-compliant') {
        nonCompliantCount++;
      } else if (complianceResult.status === 'warning') {
        warningCount++;
      } else if (complianceResult.status === 'unknown') {
        unknownCount++;
      }
      
      // Add result to array with environment info
      complianceResults.push({
        ...complianceResult,
        environmentName: environment.name,
        environmentType: environment.type,
        environmentEdition: environment.edition,
        environmentVersion: environment.version,
        detailId
      });
    }
    
    // Cross-environment license pool validation
    // Licenses are shared across environments — check total demand vs total supply per edition
    const editionPools = new Map<string, { totalProcessorRequired: number, totalNupRequired: number, processorAvailable: number, nupAvailable: number }>();
    for (const result of complianceResults) {
      const edition = result.environmentEdition || 'Unknown';
      if (!editionPools.has(edition)) {
        editionPools.set(edition, {
          totalProcessorRequired: 0,
          totalNupRequired: 0,
          processorAvailable: result.processorLicensesAvailable,
          nupAvailable: result.nupLicensesAvailable
        });
      }
      const pool = editionPools.get(edition)!;
      pool.totalProcessorRequired += result.processorLicensesRequired;
      pool.totalNupRequired += result.nupLicensesRequired;
    }
    
    const poolWarnings: any[] = [];
    for (const [edition, pool] of Array.from(editionPools.entries())) {
      const processorInsufficient = pool.processorAvailable > 0 && pool.totalProcessorRequired > pool.processorAvailable;
      const nupInsufficient = pool.nupAvailable > 0 && pool.totalNupRequired > pool.nupAvailable;
      const noProcessorLicenses = pool.processorAvailable === 0;
      const noNupLicenses = pool.nupAvailable === 0;
      
      // Oracle allows EITHER Processor OR NUP licensing
      // Only warn if neither metric can cover the total demand
      if ((processorInsufficient || noProcessorLicenses) && (nupInsufficient || noNupLicenses)) {
        if (processorInsufficient) {
          poolWarnings.push({
            edition,
            type: 'Processor',
            totalRequired: pool.totalProcessorRequired,
            available: pool.processorAvailable,
            deficit: pool.totalProcessorRequired - pool.processorAvailable,
            message: `Total processor license demand (${pool.totalProcessorRequired}) across all ${edition} environments exceeds the available pool (${pool.processorAvailable})`
          });
        }
        if (nupInsufficient) {
          poolWarnings.push({
            edition,
            type: 'NUP',
            totalRequired: pool.totalNupRequired,
            available: pool.nupAvailable,
            deficit: pool.totalNupRequired - pool.nupAvailable,
            message: `Total NUP demand (${pool.totalNupRequired}) across all ${edition} environments exceeds the available pool (${pool.nupAvailable})`
          });
        }
        if (noProcessorLicenses && noNupLicenses) {
          poolWarnings.push({
            edition,
            type: 'None',
            totalRequired: pool.totalProcessorRequired,
            available: 0,
            deficit: pool.totalProcessorRequired,
            message: `No Processor or NUP licenses found for ${edition} environments`
          });
        }
      }
    }
    
    // Update run record with summary
    await tx.update(complianceRuns).set({
      status: 'completed',
      summaryTotalEnvironments: environmentsToAnalyze.length,
      summaryCompliant: compliantCount,
      summaryNonCompliant: nonCompliantCount,
      summaryWarning: warningCount,
      summaryUnknown: unknownCount,
      updatedAt: new Date().toISOString()
    }).where(eq(complianceRuns.id, runId));
    
    // Return results
    return {
      runId,
      customerId,
      status: 'completed',
      summary: {
        totalEnvironments: environmentsToAnalyze.length,
        compliant: compliantCount,
        nonCompliant: nonCompliantCount,
        warning: warningCount,
        unknown: unknownCount
      },
      poolWarnings,
      results: complianceResults
    };  });
  
    return res.json(result);
  } catch (error) {
    logger.error(`Error running compliance analysis:`, error);
    next(error);
  }
});

// Route to get compliance runs for a customer
router.get('/customer/:customerId', async (req, res, next) => {
  const { customerId } = req.params;
  
  // IDOR protection
  const user = req.user as any;
  if (user?.role !== 'admin' && customerId !== user.id) {
    return res.status(403).json({ error: 'Unauthorized access' });
  }
  
  try {
    // Get all compliance runs for the customer
    const runs = await db.select().from(complianceRuns)
      .where(eq(complianceRuns.customerId, customerId))
      .orderBy(sql`${complianceRuns.runDate} DESC`);
      
    return res.json(runs);
  } catch (error) {
    logger.error(`Error getting compliance runs for customer:`, error);
    next(error);
  }
});

// Route to get results for a specific compliance run
router.get('/run/:runId', validateRequest(getComplianceResultsSchema), async (req, res, next) => {
  const { runId } = req.params;
  
  try {
    // Get the run record
    const run = await db.select().from(complianceRuns)
      .where(eq(complianceRuns.id, runId))
      .limit(1);
      
    if (!run.length) {
      return res.status(404).json({ error: 'Compliance run not found' });
    }
    
    // IDOR protection: verify run belongs to user's customer
    const user = req.user as any;
    if (user?.role !== 'admin' && run[0].customerId !== user.id) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }
    
    // Get all details for the run
    const details = await db.select({
      detail: complianceDetails,
      environment: environments
    }).from(complianceDetails)
      .leftJoin(environments, eq(complianceDetails.environmentId, environments.id))
      .where(eq(complianceDetails.runId, runId));
      
    // Format the response
    const result = {
      ...run[0],
      details: details.map(d => ({
        ...d.detail,
        environmentName: d.environment.name,
        environmentType: d.environment.type,
        environmentEdition: d.environment.edition,
        environmentVersion: d.environment.version
      }))
    };
    
    return res.json(result);
  } catch (error) {
    logger.error(`Error getting compliance run details:`, error);
    next(error);
  }
});

// Route to get latest compliance detail ID for an environment
router.get('/environment/:environmentId/latest-detail', async (req, res, next) => {
  const { environmentId } = req.params;
  
  try {
    // IDOR protection: verify environment ownership
    const user = req.user as any;
    if (user?.role !== 'admin') {
      const env = await db.select({ customerId: environments.customerId })
        .from(environments).where(eq(environments.id, environmentId)).execute();
      if (!env.length || env[0].customerId !== user.id) {
        return res.status(403).json({ error: 'Unauthorized access' });
      }
    }
    
    // Get the most recent compliance detail for this environment
    const latestDetail = await db.select({
      id: complianceDetails.id,
      runDate: complianceRuns.runDate
    })
    .from(complianceDetails)
    .leftJoin(complianceRuns, eq(complianceDetails.runId, complianceRuns.id))
    .where(eq(complianceDetails.environmentId, environmentId))
    .orderBy(sql`${complianceRuns.runDate} DESC`)
    .limit(1);
    
    if (!latestDetail.length) {
      return res.status(404).json({ error: 'No compliance data found for this environment' });
    }
    
    return res.json({ detailId: latestDetail[0].id });
  } catch (error) {
    logger.error(`Error getting latest compliance detail:`, error);
    next(error);
  }
});

// Route to get detailed compliance information for an environment
router.get('/detail/:detailId', validateRequest(getEnvironmentComplianceDetailsSchema), async (req, res, next) => {
  const { detailId } = req.params;
  
  try {
    // Get the detail record
    const detail = await db.select({
      detail: complianceDetails,
      environment: environments
    }).from(complianceDetails)
      .leftJoin(environments, eq(complianceDetails.environmentId, environments.id))
      .where(eq(complianceDetails.id, detailId))
      .limit(1);
    
  if (!detail.length) {
    return res.status(404).json({ error: 'Compliance detail not found' });
  }
  
    // IDOR protection: verify detail belongs to user's customer
    const user = req.user as any;
    if (user?.role !== 'admin' && detail[0].environment?.customerId !== user.id) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }
  
    // Get feature issues
  const featureIssues = await db.select({
    issue: complianceFeatureIssues,
    license: licenses
  }).from(complianceFeatureIssues)
    .leftJoin(licenses, eq(complianceFeatureIssues.licenseId, licenses.id))
    .where(eq(complianceFeatureIssues.complianceDetailId, detailId));
    
  // Get structured host details
  const hostDetails = await db.select().from(complianceHostDetails)
    .where(eq(complianceHostDetails.complianceDetailId, detailId));
    
  // Format and parse the calculation details
  const result = {
    ...detail[0].detail,
    environmentName: detail[0].environment.name,
    environmentType: detail[0].environment.type,
    environmentEdition: detail[0].environment.edition,
    environmentVersion: detail[0].environment.version,
    processorCalculationDetails: JSON.parse(detail[0].detail.processorCalculationDetails || '[]'),
    nupCalculationDetails: JSON.parse(detail[0].detail.nupCalculationDetails || '{}'),
    hostDetails: hostDetails,
    featureIssues: featureIssues.map(fi => ({
      ...fi.issue,
      licenseName: fi.license?.product,
      licenseQuantity: fi.license?.quantity
    }))  };
    
    return res.json(result);
  } catch (error) {
    logger.error(`Error getting environment compliance details:`, error);
    next(error);
  }
});

// Route to get latest compliance status for dashboard
router.get('/dashboard/:customerId', async (req, res, next) => {
  const { customerId } = req.params;
  
  // IDOR protection
  const user = req.user as any;
  if (user?.role !== 'admin' && customerId !== user.id) {
    return res.status(403).json({ error: 'Unauthorized access' });
  }
  
  try {
    // Get the most recent compliance run
    const latestRun = await db.select().from(complianceRuns)
      .where(eq(complianceRuns.customerId, customerId))
      .orderBy(sql`${complianceRuns.runDate} DESC`)
      .limit(1);
    
  if (!latestRun.length) {
    return res.json({
      hasComplianceData: false,
      message: 'No compliance data available'
    });
  }
  
  // Get summary metrics
  const summary = {
    runId: latestRun[0].id,
    runDate: latestRun[0].runDate,
    totalEnvironments: latestRun[0].summaryTotalEnvironments,
    compliant: latestRun[0].summaryCompliant,
    nonCompliant: latestRun[0].summaryNonCompliant,
    warning: latestRun[0].summaryWarning,
    unknown: latestRun[0].summaryUnknown,
    hasComplianceData: true
  };
  
  // Get non-compliant environments for quick reference
  const nonCompliantDetails = await db.select({
    detail: complianceDetails,
    environment: environments
  }).from(complianceDetails)
    .leftJoin(environments, eq(complianceDetails.environmentId, environments.id))
    .where(
      and(
        eq(complianceDetails.runId, latestRun[0].id),
        eq(complianceDetails.status, 'non-compliant')
      )
    )
    .limit(5); // Just get the first 5 for the dashboard
      // Format the response
  const result = {
    ...summary,
    nonCompliantEnvironments: nonCompliantDetails.map(d => ({
      detailId: d.detail.id,
      environmentId: d.detail.environmentId,
      environmentName: d.environment.name,
      status: d.detail.status,
      processorLicensesVariance: d.detail.processorLicensesVariance,
      nupLicensesVariance: d.detail.nupLicensesVariance
    }))
  };
  
    return res.json(result);
  } catch (error) {
    logger.error(`Error getting dashboard compliance status:`, error);
    next(error);
  }
});

// Route to erase all compliance data for a customer
router.post('/erase-data', validateRequest(eraseComplianceDataSchema), async (req, res, next) => {
  const { customerId } = req.body;
  
  // IDOR protection
  const user = req.user as any;
  if (user?.role !== 'admin' && customerId !== user.id) {
    return res.status(403).json({ error: 'Unauthorized access' });
  }
  
  try {
    return await withTransaction(async (tx) => {
      // 1. Get all compliance run IDs for this customer
      const runs = await tx.select({ id: complianceRuns.id })
        .from(complianceRuns)
        .where(eq(complianceRuns.customerId, customerId));
      
      const runIds = runs.map(run => run.id);
      
      if (runIds.length === 0) {
        return res.json({ 
          success: true, 
          message: 'No compliance data found for this customer',
          deletedRuns: 0
        });
      }
      
      // 2. Get all detail IDs associated with these runs
      const details = await tx.select({ id: complianceDetails.id })
        .from(complianceDetails)
        .where(inArray(complianceDetails.runId, runIds));
      
      const detailIds = details.map(detail => detail.id);
      
      // 3. Delete host details, feature issues (if there are any details)
      if (detailIds.length > 0) {
        await tx.delete(complianceHostDetails)
          .where(inArray(complianceHostDetails.complianceDetailId, detailIds));
        
        await tx.delete(complianceFeatureIssues)
          .where(inArray(complianceFeatureIssues.complianceDetailId, detailIds));
        
        // 4. Delete compliance details
        await tx.delete(complianceDetails)
          .where(inArray(complianceDetails.runId, runIds));
      }
      
      // 5. Delete compliance runs
      const deleteResult = await tx.delete(complianceRuns)
        .where(inArray(complianceRuns.id, runIds));
      
      logger.info(`Erased ${runIds.length} compliance runs for customer ${customerId}`);
      
      return res.json({ 
        success: true, 
        message: `Successfully erased all compliance data for the customer`,
        deletedRuns: runIds.length
      });
    });
  } catch (error) {
    logger.error(`Error erasing compliance data:`, error);
    next(error);
  }
});

// Matrix View - Get product and feature usage by environment
router.post('/matrix-view', validateRequest(getMatrixViewSchema), async (req, res, next) => {
  const { customerId } = req.body;
  
  // IDOR protection
  const user = req.user as any;
  if (user?.role !== 'admin' && customerId !== user.id) {
    return res.status(403).json({ error: 'Unauthorized access' });
  }
  
  try {
    // 1. Get all environments for the customer
    const customerEnvironments = await db.select({
      id: environments.id,
      name: environments.name,
      edition: environments.edition,
      version: environments.version,
      type: environments.type,
      primaryUse: environments.primaryUse,
      isDataGuard: environments.isDataGuard
    })
    .from(environments)
    .where(
      and(
        eq(environments.customerId, customerId),
        ne(environments.licensable, false)
      )
    );
    
    if (!customerEnvironments.length) {
      return res.json({
        environments: [],
        sharedHostGroups: [],
        licensePurchaseSummary: {
          allCompliant: true,
          totalProcessorNeeded: 0,
          sharedHostDeduction: 0,
          deduplicatedProcessorNeeded: 0,
          featureNeeds: []
        }
      });
    }
    
    // 2. Get all license products (base products and features)
    const licenseProductsData = await db.select().from(intLicenseProducts);
    
    // Separate base products from features
    const baseProducts = licenseProductsData.filter(p => p.type === 'Base Product');
    const features = licenseProductsData.filter(p => p.type === 'Feature' || p.type === 'Option Pack');
    
    // 3. For each environment, check which features are used
    const matrixData = [];
    const hostNeedMap = new Map<string, {
      hostId: string;
      hostName: string;
      licensingUnitType: string;
      environmentNames: Set<string>;
      editions: Set<string>;
      effectiveEditions: Set<string>;
      processorRequired: number;
      status: 'compliant' | 'partial' | 'non-compliant';
    }>();
    const featureNeedMap = new Map<string, Map<string, { hostName: string; environmentNames: Set<string> }>>();
    const hostStatusRank = {
      compliant: 0,
      partial: 1,
      'non-compliant': 2,
    } as const;
    
    for (const env of customerEnvironments) {
      // Get feature usage for this environment
      const rawFeatureUsage = await db.select()
        .from(featureStats)
        .where(
          and(
            eq(featureStats.environmentId, env.id),
            eq(featureStats.currentlyUsed, true)
          )
        );
      const featureUsage = filterComplianceRelevantFeatureUsage(rawFeatureUsage);
      
      // Determine effective edition using service function
      const effectiveEdition = await getEffectiveEdition(env.id, env.edition, featureUsage);
      const usesEnterpriseFeatures = effectiveEdition !== env.edition;
        // Get available licenses for this customer
      const availableLicenses = await db.select().from(licenses)
        .where(eq(licenses.customerId, customerId));
        // Create a more granular license map considering environment specifics
      // A license should only be considered valid for a feature if:
      // 1. The license product name matches the feature name, OR
      // 2. It's a feature license with the correct metric (Feature or Option Pack)
      const licenseMap = new Map();
      availableLicenses.forEach(license => {
        // For base products, we need proper edition matching
        // Use effectiveEdition (accounts for Enterprise features in Standard envs)
        if (license.product.includes('Oracle Database') && 
            license.edition && 
            effectiveEdition) {
          // If effective edition is Standard, both Standard and Enterprise licenses are valid
          if (effectiveEdition.includes('Standard') && 
              (license.edition.includes('Standard') || license.edition.includes('Enterprise'))) {
            licenseMap.set('Oracle Database', true);
          }
          // If effective edition is Enterprise, only Enterprise licenses are valid
          else if (effectiveEdition.includes('Enterprise') && license.edition.includes('Enterprise')) {
            licenseMap.set('Oracle Database', true);
          }
        }
        
        // For features/option packs: cross-reference against the product catalog.
        // license.metric is the licensing metric (Processor, Named User Plus),
        // NOT the product type. We need to check if the license product matches
        // a known Feature or Option Pack from the catalog.
        const catalogEntry = features.find(f => f.product === license.product);
        if (catalogEntry) {
          licenseMap.set(license.product, true);
        }
      });
        // Calculate cores and core factor data for this environment
      let totalCores = 0;
      let coreFactor = 0;
      let processorLicensesRequired = 0;
      let processorLicensesAvailable = 0;
      let processorLicensesVariance = 0;
      let nupLicensesRequired = 0;
      let nupLicensesAvailable = 0;
      let nupLicensesVariance = 0;
      let processorCalculation: any = { calculationDetails: [] };
      let nupCalculation: any = { calculationDetails: {} };
      
      try {        // Calculate processor license data using existing function
        processorCalculation = await calculateProcessorLicenses(env.id);
        const processorLicenses = await getAvailableProcessorLicenses(env.id, customerId);
        totalCores = processorCalculation.totalCores;
        coreFactor = processorCalculation.averageCoreFactor;
        processorLicensesRequired = processorCalculation.totalProcessorLicenses;
        processorLicensesAvailable = processorLicenses.availableLicenses;
        processorLicensesVariance = processorLicensesAvailable - processorLicensesRequired;
          // Calculate NUP licenses as well
        nupCalculation = await calculateNUPLicenses(env.id, processorCalculation);
        const nupLicenses = await getAvailableNUPLicenses(env.id, customerId);
        nupLicensesRequired = nupCalculation.nupRequired;
        nupLicensesAvailable = nupLicenses.availableNUPs;        nupLicensesVariance = nupLicensesAvailable - nupLicensesRequired;
        
        logger.debug(`Matrix view calculated licenses for environment ${env.id}: cores=${totalCores}, coreFactor=${coreFactor}`);
      } catch (error) {
        logger.error(`Error calculating license data for environment ${env.id} in matrix view: ${error}`);
        // Continue with zeros for these values in case of error
      }

      // Calculate licenses needed for unlicensed cores only
      let processorLicensesNeededForUnlicensed = 0;
      let allCoresLicensedViaAssignments = false;
      let hostDetails: any[] = [];
      try {
        hostDetails = await generateHostLicensingDetails(env.id, customerId);
        // Check if ALL cores are covered via core assignments (important for soft partitioning)
        if (hostDetails.length > 0) {
          allCoresLicensedViaAssignments = hostDetails.every(h => h.unlicensedCores === 0);
        }
        if (effectiveEdition.includes('Standard')) {
          // SE2: socket-based — just use the main processorLicensesRequired minus available
          processorLicensesNeededForUnlicensed = Math.max(0, processorLicensesRequired - processorLicensesAvailable);
        } else {
          const totalUnlicensedCores = hostDetails.reduce((sum, host) => sum + host.unlicensedCores, 0);
          const averageCoreFactor = hostDetails.length > 0 && totalUnlicensedCores > 0
            ? hostDetails.reduce((sum, host) => sum + (host.coreFactor * host.unlicensedCores), 0) / totalUnlicensedCores
            : coreFactor;
          processorLicensesNeededForUnlicensed = totalUnlicensedCores * averageCoreFactor;
        }
        
        logger.debug(`Matrix view licenses needed for unlicensed in environment ${env.id}: ${processorLicensesNeededForUnlicensed}`);
      } catch (error) {
        logger.error(`Error calculating licenses needed for unlicensed cores in environment ${env.id}: ${error}`);
        // Use the difference as fallback if we can't calculate host details
        processorLicensesNeededForUnlicensed = Math.max(0, processorLicensesRequired - processorLicensesAvailable);
      }// For environments with hard partitioning, we need to check if there are enough licenses
      const hasEnoughLicenses = processorLicensesVariance >= 0;
      
      // Get instances for this environment
      const rawInstances = await db.select({
        id: instances.id,
        environmentId: instances.environmentId,
        hostId: instances.hostId,
        name: instances.name,
        isPrimary: instances.isPrimary,
        status: instances.status,
        hostName: hosts.name,
      })
        .from(instances)
        .leftJoin(hosts, eq(instances.hostId, hosts.id))
        .where(eq(instances.environmentId, env.id));
      const environmentInstances = rawInstances;
      
      // Generate warnings for this environment
      const envWarnings: string[] = [];
      if (environmentInstances.length === 0) {
        envWarnings.push('No instances configured — compliance cannot be fully evaluated. Add instances to link this environment to its hosts.');
      }
      
      // Check for KVM with hard partitioning (Oracle does not recognize KVM as hard partitioning)
      for (const inst of environmentInstances) {
        const hostData = await db.select().from(hosts)
          .where(eq(hosts.id, inst.hostId))
          .limit(1);
        if (hostData.length) {
          const host = hostData[0];
          if (host.hasHardPartitioning && host.virtualizationType && 
              host.virtualizationType.toLowerCase().includes('kvm')) {
            envWarnings.push(`Host "${host.name}" uses KVM with hard partitioning enabled, but Oracle does not recognize KVM as a hard partitioning technology. The full physical host cores may need to be licensed.`);
          }
        }
      }
      
      // Add warning if Standard env uses Enterprise features
      if (usesEnterpriseFeatures) {
        const eeOnlyNames = new Set(features.filter(f => f.onlyEnterprise === true).map(f => f.product));
        const enterpriseFeatureNames = featureUsage
          .filter(f => eeOnlyNames.has(f.name))
          .map(f => f.name);
        envWarnings.push(`Standard Edition environment uses Enterprise-only features (${enterpriseFeatureNames.join(', ')}). Enterprise Edition licensing is required.`);
      }
      
      // Create environment data object with features and license data
      // ── Resolve feature statuses (including Tuning→Diagnostics dependency) ──
      const resolvedFeatures = features.map(feature => {
        let oracleNames: string[] = [];
        try {
          oracleNames = feature.oracleFeatureNames ? JSON.parse(feature.oracleFeatureNames) : [];
        } catch (_) { /* invalid JSON, ignore */ }
        
        let isUsed = featureUsage.some(f => {
          if (f.name === feature.product) return true;
          if (oracleNames.length > 0) {
            const fNameLower = f.name.toLowerCase();
            return oracleNames.some(oracleName => 
              f.name === oracleName || fNameLower.includes(oracleName.toLowerCase())
            );
          }
          return false;
        });
        
        const isLicensed = licenseMap.has(feature.product) && isUsed;
        
        return {
          product: feature.product,
          licensed: isLicensed,
          used: isUsed,
          onlyEnterprise: feature.onlyEnterprise,
          type: feature.type,
          status: 'unused' as string // will be computed below
        };
      });
      
      // Tuning Pack → Diagnostics Pack dependency: if Tuning is used, Diagnostics is also required
      const tuningFeature = resolvedFeatures.find(f => f.product.toLowerCase().includes('tuning'));
      const diagFeature = resolvedFeatures.find(f => f.product.toLowerCase().includes('diagnostics'));
      if (tuningFeature?.used && diagFeature && !diagFeature.used) {
        diagFeature.used = true; // Mark Diagnostics as effectively used
      }
      
      // Compute per-feature status
      for (const feat of resolvedFeatures) {
        if (feat.onlyEnterprise && !effectiveEdition.includes('Enterprise') && feat.used) {
          feat.status = 'enterprise-required';
        } else if (feat.used && feat.licensed) {
          feat.status = 'both';
        } else if (feat.used && !feat.licensed) {
          feat.status = 'used';
        } else if (!feat.used && feat.licensed) {
          feat.status = 'licensed';
        } else {
          feat.status = 'unused';
        }
      }
      
      // ── Compute complianceStatus ──
      // Pool-based check (license records) OR core-assignment-based check
      const processorOk = (processorLicensesAvailable > 0 && processorLicensesVariance >= 0) ||
                          allCoresLicensedViaAssignments;
      const nupOk = nupLicensesAvailable > 0 && nupLicensesVariance >= 0;
      const isCompliant = processorOk || nupOk;
      const hasNoLicensesAtAll = processorLicensesAvailable === 0 && nupLicensesAvailable === 0 && !allCoresLicensedViaAssignments;
      const hasFeatureIssues = resolvedFeatures.some(f => f.status === 'used' || f.status === 'enterprise-required');
      
      let complianceStatus: string;
      if (environmentInstances.length === 0) {
        complianceStatus = 'warning';
      } else if (hasFeatureIssues) {
        complianceStatus = 'non-compliant';
      } else if (isCompliant) {
        complianceStatus = 'compliant';
      } else {
        complianceStatus = 'non-compliant';
      }
      
      // ── Compute baseProductStatus ──
      let baseProductStatus: string;
      if (environmentInstances.length === 0) {
        baseProductStatus = 'unused';
      } else if (usesEnterpriseFeatures && !licenseMap.has('Oracle Database') && !allCoresLicensedViaAssignments) {
        baseProductStatus = 'used'; // Needs Enterprise but has no matching licenses
      } else if (isCompliant) {
        baseProductStatus = 'licensed';
      } else if ((licenseMap.has('Oracle Database') || allCoresLicensedViaAssignments) && !isCompliant) {
        baseProductStatus = 'used'; // Has licenses but insufficient
      } else {
        baseProductStatus = 'used'; // No base product licenses found
      }
      
      // ── Per-environment license needs ──
      const processorNeeded = Math.max(0, Math.ceil(processorLicensesNeededForUnlicensed));
      const nupNeeded = Math.max(0, -(nupLicensesVariance));
      const unlicensedFeatures = resolvedFeatures
        .filter(f => f.status === 'used' || f.status === 'enterprise-required')
        .map(f => f.product);

      for (const hostDetail of hostDetails) {
        const licensingHostId = hostDetail.licensingHostId || hostDetail.physicalHostId || hostDetail.hostId;
        const licensingHostName = hostDetail.licensingHostName || hostDetail.hostName;
        const licensingUnitType = hostDetail.serverType === 'Virtual' && hostDetail.hasHardPartitioning
          ? 'Virtual Machine'
          : 'Physical Host';
        const processorRequiredForHost = Math.ceil(hostDetail.processorLicenses || 0);
        const existingHostNeed = hostNeedMap.get(licensingHostId);

        if (!existingHostNeed) {
          hostNeedMap.set(licensingHostId, {
            hostId: licensingHostId,
            hostName: licensingHostName,
            licensingUnitType,
            environmentNames: new Set([env.name]),
            editions: new Set([env.edition]),
            effectiveEditions: new Set([effectiveEdition]),
            processorRequired: processorRequiredForHost,
            status: hostDetail.licenseStatus,
          });
        } else {
          existingHostNeed.environmentNames.add(env.name);
          existingHostNeed.editions.add(env.edition);
          existingHostNeed.effectiveEditions.add(effectiveEdition);
          existingHostNeed.processorRequired = Math.max(existingHostNeed.processorRequired, processorRequiredForHost);
          if (hostStatusRank[hostDetail.licenseStatus as keyof typeof hostStatusRank] > hostStatusRank[existingHostNeed.status]) {
            existingHostNeed.status = hostDetail.licenseStatus;
          }
        }

        for (const featureName of unlicensedFeatures) {
          if (!featureNeedMap.has(featureName)) {
            featureNeedMap.set(featureName, new Map());
          }

          const hostsForFeature = featureNeedMap.get(featureName)!;
          if (!hostsForFeature.has(licensingHostId)) {
            hostsForFeature.set(licensingHostId, {
              hostName: licensingHostName,
              environmentNames: new Set([env.name]),
            });
          } else {
            hostsForFeature.get(licensingHostId)!.environmentNames.add(env.name);
          }
        }
      }
      
      const environmentData = {
        id: env.id,
        name: env.name,
        edition: env.edition,
        effectiveEdition,
        version: env.version,
        type: env.type,
        primaryUse: env.primaryUse || '',
        databaseRole: env.isDataGuard ? 'Data Guard' : 'Primary',
        warnings: envWarnings,
        // Pre-computed compliance status
        complianceStatus,
        baseProductStatus,
        isCompliant,
        hasNoLicenses: hasNoLicensesAtAll,
        // License needs for purchase summary
        processorNeeded,
        nupNeeded,
        unlicensedFeatures,
        // Raw license calculation data
        totalCores,
        coreFactor,
        processorLicensesRequired,
        processorLicensesAvailable,
        processorLicensesVariance,
        processorLicensesNeededForUnlicensed,
        nupLicensesRequired,
        nupLicensesAvailable,
        nupLicensesVariance,
        processorCalculationDetails: JSON.stringify(processorCalculation.calculationDetails || []),
        nupCalculationDetails: JSON.stringify(nupCalculation.calculationDetails || {}),
        instances: environmentInstances,
        baseProducts: baseProducts.map(product => ({
          product: product.product,
          licensed: licenseMap.has(product.product) && hasEnoughLicenses,
          onlyEnterprise: product.onlyEnterprise
        })),
        features: resolvedFeatures
      };
      
      matrixData.push(environmentData);
    }
    
    // Cross-environment host deduplication via service function
    const sharedHostGroups = await detectSharedHostGroups(matrixData);
    
    // ── Build license purchase summary ──
    let totalProcessorNeeded = 0;
    let allCompliant = true;
    
    for (const env of matrixData) {
      if (env.complianceStatus !== 'compliant') allCompliant = false;
      totalProcessorNeeded += env.processorNeeded;
      
    }
    
    // Apply shared host deduction: environments sharing a physical host
    // only need the host licensed once instead of N times
    let sharedHostDeduction = 0;
    for (const group of sharedHostGroups) {
      // Sum individual per-env processor needs for the shared environments
      const sharedEnvs = matrixData.filter(e => group.environmentIds.includes(e.id));
      const sumIndividual = sharedEnvs.reduce((sum, e) => sum + e.processorNeeded, 0);
      // The host only needs licensing once → save the difference
      if (sumIndividual > group.sharedProcessorLicenses) {
        sharedHostDeduction += sumIndividual - group.sharedProcessorLicenses;
      }
    }
    
    const deduplicatedProcessorNeeded = Math.max(0, totalProcessorNeeded - sharedHostDeduction);
    
    // Build feature purchase list with deduplication
    const hostNeeds = Array.from(hostNeedMap.values())
      .filter((hostNeed) => hostNeed.status !== 'compliant')
      .map((hostNeed) => ({
        hostId: hostNeed.hostId,
        hostName: hostNeed.hostName,
        licensingUnitType: hostNeed.licensingUnitType,
        environmentNames: Array.from(hostNeed.environmentNames).sort(),
        editions: Array.from(hostNeed.editions).sort(),
        effectiveEditions: Array.from(hostNeed.effectiveEditions).sort(),
        processorRequired: hostNeed.processorRequired,
        status: hostNeed.status,
      }))
      .sort((a, b) => a.hostName.localeCompare(b.hostName));

    const featureNeeds: Array<{
      feature: string;
      hostNames: string[];
      environmentNames: string[];
      requiredHostCount: number;
    }> = [];
    featureNeedMap.forEach((hostsForFeature, featName) => {
      const hostEntries = Array.from(hostsForFeature.values());
      const environmentNames = new Set<string>();

      for (const hostEntry of hostEntries) {
        hostEntry.environmentNames.forEach((environmentName) => environmentNames.add(environmentName));
      }

      featureNeeds.push({
        feature: featName,
        hostNames: hostEntries.map((entry) => entry.hostName).sort(),
        environmentNames: Array.from(environmentNames).sort(),
        requiredHostCount: hostEntries.length,
      });
    });
    
    const licensePurchaseSummary = {
      allCompliant,
      totalProcessorNeeded,
      sharedHostDeduction,
      deduplicatedProcessorNeeded,
      hostNeeds,
      featureNeeds
    };
    
    return res.json({ environments: matrixData, sharedHostGroups, licensePurchaseSummary });
  } catch (error) {
    logger.error(`Error generating matrix view:`, error);
    next(error);
  }
});

export default router;

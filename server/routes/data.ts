import { Router } from 'express';
import { safeOperation, withTransaction } from '../utils/error-handler';
import db from '../database';
import { 
  pdbs, featureStats, coreAssignments, 
  coreLicenseMappings, environments, hosts
} from '../../shared/schema';
import { eq, sql, inArray } from 'drizzle-orm';
import { z } from 'zod';
import logger from '../utils/logger';

const router = Router();

// Get PDBs
router.get('/pdbs', async (req, res, next) => {
  try {
    const user = req.user as any;
    let data;
    
    if (user?.role !== 'admin') {
      // IDOR protection: only return PDBs for customer's environments
      const userEnvs = await db.select({ id: environments.id })
        .from(environments).where(eq(environments.customerId, user.id)).execute();
      const envIds = userEnvs.map(e => e.id);
      data = envIds.length > 0
        ? await db.select().from(pdbs).where(inArray(pdbs.environmentId, envIds)).execute()
        : [];
    } else {
      data = await safeOperation(
        async () => await db.select().from(pdbs).execute(),
        'Error fetching pdbs'
      );
    }
    
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get Feature Stats for a specific environment
router.get('/feature-stats', async (req, res, next) => {
  try {
    const environmentId = req.query.environmentId as string;
    const user = req.user as any;
    
    // IDOR protection: verify environment ownership for non-admin users
    if (user?.role !== 'admin') {
      if (environmentId) {
        const env = await db.select({ customerId: environments.customerId })
          .from(environments).where(eq(environments.id, environmentId)).execute();
        if (!env.length || env[0].customerId !== user.id) {
          return res.status(403).json({ error: 'Unauthorized access' });
        }
      } else {
        // Non-admin without environmentId: return only their environments' feature stats
        const userEnvs = await db.select({ id: environments.id })
          .from(environments).where(eq(environments.customerId, user.id)).execute();
        const envIds = userEnvs.map(e => e.id);
        const data = envIds.length > 0
          ? await db.select().from(featureStats).where(inArray(featureStats.environmentId, envIds)).execute()
          : [];
        return res.json(data);
      }
    }
    
    const data = await safeOperation(async () => {
      if (environmentId) {
        return await db
          .select()
          .from(featureStats)
          .where(eq(featureStats.environmentId, environmentId))
          .execute();
      } else {
        return await db.select().from(featureStats).execute();
      }
    }, 'Error fetching feature stats');
    
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Create or update feature stat
router.post('/feature-stats', async (req, res, next) => {
  try {
    // Validar los datos con Zod
    const featureStatSchema = z.object({
      name: z.string().min(1, 'El nombre es requerido'),
      environmentId: z.string().min(1, 'El ID del entorno es requerido'),
      status: z.enum(['Licensed', 'Not Licensed', 'No Disponible']).optional().default('Not Licensed'),
      currentlyUsed: z.boolean().optional().default(false),
      detectedUsages: z.number().nonnegative().optional().default(0),
      firstUsageDate: z.string().nullable().optional(),
      lastUsageDate: z.string().nullable().optional()
    });
    const validatedData = featureStatSchema.parse(req.body);
    
    // IDOR protection: verify environment ownership
    const user = req.user as any;
    if (user?.role !== 'admin') {
      const env = await db.select({ customerId: environments.customerId })
        .from(environments).where(eq(environments.id, validatedData.environmentId)).execute();
      if (!env.length || env[0].customerId !== user.id) {
        return res.status(403).json({ error: 'Unauthorized access' });
      }
    }
    
    // Insert new feature stat
    const result = await withTransaction(async (tx) => {
      // Construir objeto de inserción con valores predeterminados para campos opcionales
      const insertData: any = {
        name: validatedData.name,
        environmentId: validatedData.environmentId,
        status: validatedData.status || 'Not Licensed', // Asegurar que status esté presente
        currentlyUsed: validatedData.currentlyUsed !== undefined ? validatedData.currentlyUsed : false,
        detectedUsages: validatedData.detectedUsages !== undefined ? validatedData.detectedUsages : 0,
        firstUsageDate: validatedData.firstUsageDate,
        lastUsageDate: validatedData.lastUsageDate,
        updatedAt: new Date().toISOString()
      };
      
      const inserted = await tx
        .insert(featureStats)
        .values(insertData)
        .returning()
        .execute();
        
      return inserted[0];
    });
    
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Datos de entrada inválidos', 
        details: error.errors 
      });
    }
    next(error);
  }
});

// Update feature stat
router.put('/feature-stats/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    // Validar los datos con Zod
    const featureStatSchema = z.object({
      name: z.string().min(1, 'El nombre es requerido'),
      environmentId: z.string().min(1, 'El ID del entorno es requerido'),
      status: z.enum(['Licensed', 'Not Licensed', 'No Disponible']).optional().default('Not Licensed'),
      currentlyUsed: z.boolean().optional().default(false),
      detectedUsages: z.number().nonnegative().optional().default(0),
      firstUsageDate: z.string().nullable().optional(),
      lastUsageDate: z.string().nullable().optional()
    });
    const validatedData = featureStatSchema.parse(req.body);
    
    // IDOR protection: verify environment ownership
    const user = req.user as any;
    if (user?.role !== 'admin') {
      const env = await db.select({ customerId: environments.customerId })
        .from(environments).where(eq(environments.id, validatedData.environmentId)).execute();
      if (!env.length || env[0].customerId !== user.id) {
        return res.status(403).json({ error: 'Unauthorized access' });
      }
    }
    
    // Update feature stat using transaction
    const result = await withTransaction(async (tx) => {
      // Construir objeto de actualización con los campos que existen
      const updateData: any = {
        name: validatedData.name,
        environmentId: validatedData.environmentId,
        status: validatedData.status || 'Not Licensed' // Asegurar que status esté presente
      };
      
      // Añadir campos opcionales solo si están definidos
      if (validatedData.currentlyUsed !== undefined) {
        updateData.currentlyUsed = validatedData.currentlyUsed;
      }
      
      if (validatedData.detectedUsages !== undefined) {
        updateData.detectedUsages = validatedData.detectedUsages;
      }
      
      if (validatedData.firstUsageDate !== undefined) {
        updateData.firstUsageDate = validatedData.firstUsageDate;
      }
      
      if (validatedData.lastUsageDate !== undefined) {
        updateData.lastUsageDate = validatedData.lastUsageDate;
      }
      
      // Añadir fecha de actualización
      updateData.updatedAt = new Date().toISOString();
      
      const updated = await tx
        .update(featureStats)
        .set(updateData)
        .where(eq(featureStats.id, id))
        .returning()
        .execute();
        
      if (updated.length === 0) {
        const error: any = new Error('Feature stat not found');
        error.status = 404;
        throw error;
      }
      
      return updated[0];
    });
    
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Datos de entrada inválidos', 
        details: error.errors 
      });
    }
    next(error);
  }
});

// NUEVO ENDPOINT: Actualizar múltiples feature stats
router.post('/feature-stats-batch', async (req, res, next) => {
  try {
    // Validar que se haya enviado un array
    if (!Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Se esperaba un array de features stats' });
    }
    
    // Validar cada feature
    const featureStatSchema = z.object({
      id: z.number().optional(),
      name: z.string().min(1, 'El nombre es requerido'),
      environmentId: z.string().min(1, 'El ID del entorno es requerido'),
      status: z.enum(['Licensed', 'Not Licensed', 'No Disponible']).optional().default('Not Licensed'),
      currentlyUsed: z.boolean().optional().default(false),
      detectedUsages: z.number().nonnegative().optional().default(0),
      firstUsageDate: z.string().nullable().optional(),
      lastUsageDate: z.string().nullable().optional()
    });
    
    // Procesar todos los features en una transacción
    // IDOR protection: verify all environmentIds belong to user's customer
    const user = req.user as any;
    if (user?.role !== 'admin') {
      const uniqueEnvIds = [...new Set(req.body.map((f: any) => f.environmentId).filter(Boolean))] as string[];
      if (uniqueEnvIds.length > 0) {
        const envs = await db.select({ id: environments.id, customerId: environments.customerId })
          .from(environments).where(inArray(environments.id, uniqueEnvIds)).execute();
        const unauthorized = envs.some(e => e.customerId !== user.id);
        if (unauthorized || envs.length !== uniqueEnvIds.length) {
          return res.status(403).json({ error: 'Unauthorized access' });
        }
      }
    }
    
    const result = await withTransaction(async (tx) => {
      const results = [];
      
      for (const featureData of req.body) {
        try {
          // Validar los datos
          const validatedData = featureStatSchema.parse(featureData);
          
          if (validatedData.id && validatedData.id > 0) {
            // Actualizar feature existente
            const updateData: any = {
              name: validatedData.name,
              environmentId: validatedData.environmentId,
              status: validatedData.status || 'Not Licensed'
            };
            
            // Añadir campos opcionales
            if (validatedData.currentlyUsed !== undefined) {
              updateData.currentlyUsed = validatedData.currentlyUsed;
            }
            
            if (validatedData.detectedUsages !== undefined) {
              updateData.detectedUsages = validatedData.detectedUsages;
            }
            
            if (validatedData.firstUsageDate !== undefined) {
              updateData.firstUsageDate = validatedData.firstUsageDate;
            }
            
            if (validatedData.lastUsageDate !== undefined) {
              updateData.lastUsageDate = validatedData.lastUsageDate;
            }
            
            // Añadir timestamp de actualización
            updateData.updatedAt = new Date().toISOString();
            
            const updated = await tx
              .update(featureStats)
              .set(updateData)
              .where(eq(featureStats.id, validatedData.id))
              .returning()
              .execute();
              
            if (updated.length > 0) {
              results.push(updated[0]);
            }
          } else {
            // Crear nuevo feature
            const insertData: any = {
              name: validatedData.name,
              environmentId: validatedData.environmentId,
              status: validatedData.status || 'Not Licensed',
              currentlyUsed: validatedData.currentlyUsed !== undefined ? validatedData.currentlyUsed : false,
              detectedUsages: validatedData.detectedUsages !== undefined ? validatedData.detectedUsages : 0,
              firstUsageDate: validatedData.firstUsageDate,
              lastUsageDate: validatedData.lastUsageDate,
              updatedAt: new Date().toISOString()
            };
            
            const inserted = await tx
              .insert(featureStats)
              .values(insertData)
              .returning()
              .execute();
              
            if (inserted.length > 0) {
              results.push(inserted[0]);
            }
          }
        } catch (itemError) {
          // Log error pero continuar con los demás items
          logger.error(`Error processing feature stat: ${itemError}`);
        }
      }
      
      return results;
    });
    
    res.status(200).json({
      success: true,
      count: result.length,
      results: result
    });
  } catch (error) {
    logger.error(`Error procesando batch de feature stats: ${error}`);
    next(error);
  }
});

// Get Core Assignments
router.get('/core-assignments', async (req, res, next) => {
  try {
    const user = req.user as any;
    let data;
    
    if (user?.role !== 'admin') {
      // IDOR protection: only return core assignments for customer's hosts
      const userHosts = await db.select({ id: hosts.id })
        .from(hosts).where(eq(hosts.customerId, user.id)).execute();
      const hostIds = userHosts.map(h => h.id);
      data = hostIds.length > 0
        ? await db.select().from(coreAssignments).where(inArray(coreAssignments.hostId, hostIds)).execute()
        : [];
    } else {
      data = await safeOperation(
        async () => await db.select().from(coreAssignments).execute(),
        'Error fetching core assignments'
      );
    }
    
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get Core License Mappings
router.get('/core-license-mappings', async (req, res, next) => {
  try {
    const user = req.user as any;
    
    if (user?.role !== 'admin') {
      // IDOR protection: only return mappings for customer's hosts
      const userHosts = await db.select({ id: hosts.id })
        .from(hosts).where(eq(hosts.customerId, user.id)).execute();
      const hostIds = userHosts.map(h => h.id);
      
      if (hostIds.length === 0) {
        return res.json([]);
      }
      
      const userCoreAssignments = await db.select({ id: coreAssignments.id })
        .from(coreAssignments).where(inArray(coreAssignments.hostId, hostIds)).execute();
      const caIds = userCoreAssignments.map(ca => ca.id);
      
      if (caIds.length === 0) {
        return res.json([]);
      }
      
      const data = await db
        .select({
          id: coreLicenseMappings.coreAssignmentId,
          coreAssignmentId: coreLicenseMappings.coreAssignmentId,
          licenseId: coreLicenseMappings.licenseId,
          assignmentDate: coreLicenseMappings.assignmentDate,
          notes: coreLicenseMappings.notes
        })
        .from(coreLicenseMappings)
        .where(inArray(coreLicenseMappings.coreAssignmentId, caIds))
        .execute();
      
      return res.json(data);
    }
    
    const data = await safeOperation(async () => {
      return await db
        .select({
          id: coreLicenseMappings.coreAssignmentId,
          coreAssignmentId: coreLicenseMappings.coreAssignmentId,
          licenseId: coreLicenseMappings.licenseId,
          assignmentDate: coreLicenseMappings.assignmentDate,
          notes: coreLicenseMappings.notes
        })
        .from(coreLicenseMappings)
        .execute();
    }, 'Error fetching core license mappings');
    
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get License Host Mappings - Deprecated endpoint
router.get('/license-host-mappings', async (req, res, next) => {
  // Return empty array as this table has been replaced by core_license_mappings
  logger.warn('Deprecated endpoint /license-host-mappings accessed - this table has been replaced by core_license_mappings');
  res.json([]);
});

export default router;

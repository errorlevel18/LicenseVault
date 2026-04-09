import { Router } from 'express';
import { z } from 'zod';
import db from '../database';
import { environments, featureStats, hosts, instances, pdbs } from '../../shared/schema';
import { v4 as uuidv4 } from 'uuid';
import { safeOperation, withTransaction } from '../utils/error-handler';
import logger from '../utils/logger';
import { validateRequest } from '../middlewares/validationMiddleware';
import { and, eq, inArray, sql } from 'drizzle-orm';

const router = Router();

const draftInstanceSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  hostId: z.string().optional(),
  environmentId: z.string().optional(),
  isPrimary: z.boolean().optional(),
  status: z.string().optional(),
});

const validateEnvironmentDraftSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({
    customerId: z.string().min(1, 'El ID del cliente es requerido'),
    environmentId: z.string().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    version: z.string().optional(),
    edition: z.string().optional(),
    dbType: z.string().optional(),
    instances: z.array(draftInstanceSchema).optional().default([]),
  }),
  query: z.object({}).optional(),
});

type DraftInstance = z.infer<typeof draftInstanceSchema>;

type EnvironmentDraftValidationResult = {
  normalizedValues: {
    edition?: string;
    dbType?: string;
  };
  errors: {
    environmentName?: string;
    instanceName?: string;
    hostId?: string;
    form: string[];
  };
  isValid: boolean;
};

function getUserCustomerAccess(req: any, customerId: string) {
  const user = req.user as { id: string; role: 'admin' | 'customer'; customerId?: string } | undefined;
  const isAdmin = user?.role === 'admin';
  const userCustomerId = user?.role === 'customer' ? user.id : user?.customerId;

  if (!isAdmin && customerId !== userCustomerId) {
    const error: any = new Error('Unauthorized access to this customer environment flow');
    error.status = 403;
    throw error;
  }
}

function getVersionNumber(version?: string) {
  if (!version) {
    return 0;
  }

  const match = version.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : 0;
}

function normalizeEnvironmentDraftValues(draft: {
  edition?: string;
  type?: string;
  version?: string;
  dbType?: string;
}) {
  const normalizedValues = {
    edition: draft.edition,
    dbType: draft.dbType,
  };

  if (draft.type === 'RAC' || draft.type === 'Rac One Node') {
    normalizedValues.edition = 'Enterprise';
  }

  if (getVersionNumber(draft.version) > 0 && getVersionNumber(draft.version) < 12) {
    normalizedValues.dbType = 'Non-CDB';
  }

  return normalizedValues;
}

async function validateEnvironmentDraft(
  tx: typeof db | any,
  draft: {
    customerId: string;
    environmentId?: string;
    name?: string;
    type?: string;
    version?: string;
    edition?: string;
    dbType?: string;
    instances?: DraftInstance[];
  },
): Promise<EnvironmentDraftValidationResult> {
  const normalizedValues = normalizeEnvironmentDraftValues(draft);
  const errors: EnvironmentDraftValidationResult['errors'] = {
    form: [],
  };

  const trimmedName = draft.name?.trim();
  if (trimmedName) {
    const matchingEnvironments = await tx
      .select({ id: environments.id, name: environments.name })
      .from(environments)
      .where(
        and(
          eq(environments.customerId, draft.customerId),
          sql`lower(${environments.name}) = lower(${trimmedName})`,
        ),
      )
      .limit(2)
      .execute();

    const conflictingEnvironment = matchingEnvironments.find((environment: any) => environment.id !== draft.environmentId);
    if (conflictingEnvironment) {
      errors.environmentName = `An environment named "${conflictingEnvironment.name}" already exists for this customer.`;
    }
  }

  const versionNumber = getVersionNumber(draft.version);
  if ((draft.dbType === 'CDB' || normalizedValues.dbType === 'CDB') && versionNumber > 0 && versionNumber < 12) {
    errors.form.push('CDB environments require version 12 or higher.');
  }

  const draftInstances = (draft.instances || []).filter((instance) => instance.name || instance.hostId);
  if (draft.type === 'Standalone' && draftInstances.length > 1) {
    errors.form.push('Standalone environments can only have 1 instance.');
  }

  const seenNames = new Set<string>();
  for (const instance of draftInstances) {
    const normalizedName = instance.name?.trim().toLowerCase();
    if (!normalizedName) {
      continue;
    }

    if (seenNames.has(normalizedName)) {
      errors.instanceName = 'An instance with this name already exists in this environment.';
      break;
    }

    seenNames.add(normalizedName);
  }

  const seenHostIds = new Set<string>();
  for (const instance of draftInstances) {
    if (!instance.hostId) {
      continue;
    }

    if (seenHostIds.has(instance.hostId)) {
      errors.hostId = 'This host is already used by another instance in this environment.';
      break;
    }

    seenHostIds.add(instance.hostId);
  }

  const uniqueHostIds = [...new Set(draftInstances.map((instance) => instance.hostId).filter(Boolean))] as string[];
  if (uniqueHostIds.length > 0) {
    const availableHosts = await tx
      .select({ id: hosts.id })
      .from(hosts)
      .where(and(eq(hosts.customerId, draft.customerId), inArray(hosts.id, uniqueHostIds)))
      .execute();

    if (availableHosts.length !== uniqueHostIds.length) {
      errors.hostId = 'One or more selected hosts do not belong to the selected customer.';
    }
  }

  return {
    normalizedValues,
    errors,
    isValid: !errors.environmentName && !errors.instanceName && !errors.hostId && errors.form.length === 0,
  };
}

function throwDraftValidationError(validation: EnvironmentDraftValidationResult) {
  const error: any = new Error(validation.errors.environmentName || validation.errors.instanceName || validation.errors.hostId || validation.errors.form[0] || 'Environment validation failed');
  error.status = validation.errors.environmentName ? 409 : 400;
  error.validation = validation;
  throw error;
}

// Schema para validar la creación de un entorno
const createEnvironmentSchema = z.object({
  params: z.object({}).optional(),
  body: z.object({
    name: z.string().min(1, 'El nombre es requerido'),
    description: z.string().optional(),
    customerId: z.string().min(1, 'El ID del cliente es requerido'),
    status: z.enum(['active', 'inactive', 'maintenance']).optional().default('active'),
    type: z.string().optional(),
    version: z.string().optional(),
    edition: z.string().optional(),
    primaryUse: z.string().optional(),
    dbType: z.string().optional(),
    isDataGuard: z.boolean().optional(),
    licensable: z.boolean().optional(),
    options: z.array(z.string()).optional(),
    managementPacks: z.array(z.string()).optional(),
    instances: z.array(draftInstanceSchema.extend({
      id: z.string(),
      name: z.string(),
      hostId: z.string(),
    })).optional(),
    featureStats: z.array(
      z.object({
        name: z.string(),
        currentlyUsed: z.boolean().optional(),
        detectedUsages: z.number().optional(),
        firstUsageDate: z.string().nullable().optional(),
        lastUsageDate: z.string().nullable().optional()
      })
    ).optional()
  }),
  query: z.object({}).optional()
});

/**
 * Endpoint para crear un nuevo entorno
 */
router.post('/', validateRequest(createEnvironmentSchema), async (req, res, next) => {
  try {
    const environmentData = req.body;
    const { instances: instancesData, featureStats: featureStatsData, ...mainEnvData } = environmentData;

    logger.debug({ environmentData, user: req.user, path: req.path }, 'Create environment request received');

    // Validar permisos del usuario
    const user = req.user as any;
    const isAdmin = user?.role === 'admin';
    // Para usuarios con rol "customer", el ID del cliente está en user.id
    const userCustomerId = user.role === 'customer' ? user.id : user.customerId;

    // Si no es admin, solo puede crear para su propio cliente
    if (!isAdmin && environmentData.customerId !== userCustomerId) {
      logger.warn({
        isAdmin,
        requestedCustomerId: environmentData.customerId,
        userCustomerId
      }, 'Permission denied for environment creation');
      
      return res.status(403).json({ error: 'Cannot create environment for other customers' });
    }

    // Usar transacción para crear el entorno y datos relacionados
    const createdEnvironment = await withTransaction(async (tx) => {
      const validation = await validateEnvironmentDraft(tx, {
        customerId: mainEnvData.customerId,
        name: mainEnvData.name,
        type: mainEnvData.type,
        version: mainEnvData.version,
        edition: mainEnvData.edition,
        dbType: mainEnvData.dbType,
        instances: instancesData,
      });

      if (!validation.isValid) {
        throwDraftValidationError(validation);
      }

      // Generar un UUID para el nuevo entorno
      const environmentId = uuidv4();
      
      // Crear el entorno principal
      const newEnv = await tx
        .insert(environments)
        .values({
          id: environmentId,
          name: mainEnvData.name,
          description: mainEnvData.description || '',
          customerId: mainEnvData.customerId,
          status: mainEnvData.status || 'active',
          type: mainEnvData.type || '',
          version: mainEnvData.version || '',
          edition: validation.normalizedValues.edition || mainEnvData.edition || '',
          primaryUse: mainEnvData.primaryUse || '',
          dbType: validation.normalizedValues.dbType || mainEnvData.dbType || '',
          isDataGuard: mainEnvData.isDataGuard || false,
          licensable: mainEnvData.licensable !== undefined ? mainEnvData.licensable : true,
          options: mainEnvData.options ? JSON.stringify(mainEnvData.options) : null,
          managementPacks: mainEnvData.managementPacks ? JSON.stringify(mainEnvData.managementPacks) : null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        .returning()
        .execute();      // Si se incluyen instancias, crearlas
      if (instancesData && Array.isArray(instancesData) && instancesData.length > 0) {
        for (const instance of instancesData) {
          // Verificar que tenemos los datos mínimos necesarios
          if (instance.name && instance.hostId) {
            await tx
              .insert(instances)
              .values({
                id: uuidv4(), // Siempre generar un nuevo UUID, ignorando cualquier ID temporal del cliente
                environmentId: environmentId,
                name: instance.name,
                hostId: instance.hostId,
                isPrimary: instance.isPrimary || false,
                status: instance.status || 'Running',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              })
              .execute();
            logger.debug(`Instance ${instance.name} created for new environment ${environmentId}`);
          }
        }
      }

      // Si se incluyen estadísticas de feature, crearlas
      if (featureStatsData && Array.isArray(featureStatsData) && featureStatsData.length > 0) {
        for (const feature of featureStatsData) {
          await tx
            .insert(featureStats)
            .values({
              environmentId: environmentId,
              name: feature.name,
              currentlyUsed: feature.currentlyUsed || false,
              detectedUsages: feature.detectedUsages || 0,
              firstUsageDate: feature.firstUsageDate,
              lastUsageDate: feature.lastUsageDate,
              status: 'Not Licensed',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            })
            .execute();
        }
      }

      return newEnv[0];
    });

    // Obtener el environment completo con sus relaciones
    const completeEnvironment = await db
      .select()
      .from(environments)
      .where(eq(environments.id, createdEnvironment.id))
      .execute();

    logger.info(`Environment ${createdEnvironment.id} created successfully`);
    res.status(201).json(completeEnvironment[0]);
    
  } catch (error) {
    if ((error as any)?.validation) {
      return res.status((error as any).status || 400).json({
        error: (error as Error).message,
        validation: (error as any).validation,
      });
    }

    logger.error({ error, body: req.body }, 'Error creating environment');
    next(error);
  }
});

router.post('/validate-draft', validateRequest(validateEnvironmentDraftSchema), async (req, res, next) => {
  try {
    const draft = req.body;
    getUserCustomerAccess(req, draft.customerId);

    const validation = await validateEnvironmentDraft(db, draft);
    res.json(validation);
  } catch (error) {
    next(error);
  }
});

// Get all environments with optional customerId filter
router.get('/', async (req, res, next) => {
  try {
    logger.debug({ user: req.user, path: req.path, query: req.query }, 'Get environments request received');
    
    let customerId = req.query.customerId as string | undefined;
    
    // IDOR protection: non-admin users can only see their own data
    const user = req.user as any;
    if (user?.role !== 'admin') {
      customerId = user.id;
    }
    
    let environmentsData;
    if (customerId) {
      // If customerId is provided, filter by it
      environmentsData = await db
        .select()
        .from(environments)
        .where(eq(environments.customerId, customerId))
        .execute();
    } else {
      // Otherwise return all environments (admin only)
      environmentsData = await db
        .select()
        .from(environments)
        .execute();
    }

    // Obtener todas las instancias de los entornos encontrados
    const environmentIds = environmentsData.map(env => env.id);
    let instancesData = [];
    if (environmentIds.length > 0) {
      instancesData = await db
        .select()
        .from(instances)
        .where(inArray(instances.environmentId, environmentIds))
        .execute();
    }

    // Asociar instancias a cada entorno
    const environmentsWithInstances = environmentsData.map(env => ({
      ...env,
      instances: instancesData.filter(inst => inst.environmentId === env.id)
    }));
    
    res.json(environmentsWithInstances);
    logger.debug(`Get all environments request successful`);
  } catch (error) {
    logger.error({ error, query: req.query }, 'Error fetching environments');
    next(error);
  }
});

// Get environment by ID
router.get('/:id', async (req, res, next) => {
  const { id } = req.params;
  
  logger.debug({ id, user: req.user, path: req.path }, 'Get environment by ID request received');
  
  try {
    const environment = await db
      .select()
      .from(environments)
      .where(eq(environments.id, id))
      .execute();
      
    if (!environment.length) {
      return res.status(404).json({ error: 'Environment not found' });
    }

    // IDOR protection: non-admin users can only access their own environments
    const user = req.user as any;
    if (user?.role !== 'admin' && environment[0].customerId !== user.id) {
      return res.status(403).json({ error: 'Unauthorized access to environment' });
    }

    // Obtener las instancias asociadas a este entorno
    const instancesData = await db
      .select()
      .from(instances)
      .where(eq(instances.environmentId, id))
      .execute();
    
    logger.info(`Get environment ${id} request successful`);
    res.json({ ...environment[0], instances: instancesData });
  } catch (error) {
    logger.error({ error, environmentId: id }, 'Error fetching environment');
    next(error);
  }
});

// Get feature stats for a specific environment
router.get('/:id/feature-stats', async (req, res, next) => {
  const { id } = req.params;
  
  // IDOR protection: verify environment ownership
  const user = req.user as any;
  if (user?.role !== 'admin') {
    const env = await db.select({ customerId: environments.customerId })
      .from(environments).where(eq(environments.id, id)).execute();
    if (!env.length || env[0].customerId !== user.id) {
      return res.status(403).json({ error: 'Unauthorized access to environment features' });
    }
  }
  
  // Use safeOperation for error handling
  const features = await safeOperation(async () => {
    return await db.select()
      .from(featureStats)
      .where(eq(featureStats.environmentId, id))
      .orderBy(featureStats.name)
      .execute();
  }, 'Error fetching feature stats');
  
  if (features instanceof Error) {
    return next(features);
  }
  
  res.json(features);
});

// Schema para validar la actualización de un entorno
const updateEnvironmentSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'ID del entorno es requerido')
  }),
  body: z.object({
    name: z.string().min(1, 'El nombre es requerido').optional(),
    description: z.string().optional(),
    customerId: z.string().optional(),
    status: z.enum(['active', 'inactive', 'maintenance']).optional(),
    type: z.string().optional(),
    version: z.string().optional(),
    // Campos adicionales según el esquema completo de Environment
    edition: z.string().optional(),
    primaryUse: z.string().optional(),
    dbType: z.string().optional(),
    isDataGuard: z.boolean().optional(),
    licensable: z.boolean().optional(),
    options: z.array(z.string()).optional(),
    managementPacks: z.array(z.string()).optional(),
    // Campos para instancias y estadísticas de features
    instances: z.array(draftInstanceSchema.extend({
      id: z.string(),
      name: z.string(),
    })).optional(),
    featureStats: z.array(
      z.object({
        id: z.number().optional(),
        environmentId: z.string().optional(),
        name: z.string(),
        currentlyUsed: z.boolean().optional(),
        detectedUsages: z.number().optional(),
        firstUsageDate: z.string().nullable().optional(),
        lastUsageDate: z.string().nullable().optional()
      })
    ).optional()
  }),
  query: z.object({}).optional()
});

/**
 * Endpoint para actualizar un entorno existente
 */
router.put('/:id', validateRequest(updateEnvironmentSchema), async (req, res, next) => {
  const { id } = req.params;
  const updateData = req.body;
  
  logger.debug({ id, updateData, user: req.user, path: req.path }, 'Update environment request received');
  
  try {
    // Verificar que el entorno existe
    const existingEnvironment = await db
      .select()
      .from(environments)
      .where(eq(environments.id, id))
      .execute();
      
    if (!existingEnvironment.length) {
      logger.warn(`Environment with ID ${id} not found`);
      return res.status(404).json({ error: 'Environment not found' });
    }
    
    // Validar permisos del usuario
    const user = req.user as any;
    const isAdmin = user?.role === 'admin';
    // Para usuarios con rol "customer", el ID del cliente está en user.id
    const userCustomerId = user.role === 'customer' ? user.id : user.customerId;
    
    // Solo admins o usuarios del mismo cliente pueden actualizar
    if (!isAdmin && existingEnvironment[0].customerId !== userCustomerId) {
      logger.warn({ 
        isAdmin, 
        environmentCustomerId: existingEnvironment[0].customerId, 
        userCustomerId 
      }, 'Permission denied for environment update');
      
      return res.status(403).json({ error: 'Unauthorized access to environment' });
    }
    
    // Si un usuario no admin intenta cambiar el customerId, rechazar
    if (!isAdmin && updateData.customerId && updateData.customerId !== existingEnvironment[0].customerId) {
      logger.warn('Non-admin user attempting to change customer ID');
      return res.status(403).json({ error: 'Cannot change environment customer ID' });
    }
      // Usar transacción para actualizar el entorno y datos relacionados
    const updatedEnvironment = await withTransaction(async (tx) => {
      // Extraer los datos de instancias y features si existen
      const { instances: instancesData, featureStats: featureStatsData, ...environmentData } = updateData;
      const currentInstances = await tx
        .select()
        .from(instances)
        .where(eq(instances.environmentId, id))
        .execute();

      const validation = await validateEnvironmentDraft(tx, {
        customerId: existingEnvironment[0].customerId,
        environmentId: id,
        name: environmentData.name ?? existingEnvironment[0].name,
        type: environmentData.type ?? existingEnvironment[0].type,
        version: environmentData.version ?? existingEnvironment[0].version,
        edition: environmentData.edition ?? existingEnvironment[0].edition,
        dbType: environmentData.dbType ?? existingEnvironment[0].dbType,
        instances: instancesData ?? currentInstances,
      });

      if (!validation.isValid) {
        throwDraftValidationError(validation);
      }
      
      // Serialize array fields to JSON strings for storage in text columns
      if (environmentData.options !== undefined) {
        environmentData.options = environmentData.options ? JSON.stringify(environmentData.options) : null;
      }
      if (environmentData.managementPacks !== undefined) {
        environmentData.managementPacks = environmentData.managementPacks ? JSON.stringify(environmentData.managementPacks) : null;
      }
      
      // Actualizar el entorno principal
      const updatedEnv = await tx
        .update(environments)
        .set({
          ...environmentData,
          edition: validation.normalizedValues.edition ?? environmentData.edition,
          dbType: validation.normalizedValues.dbType ?? environmentData.dbType,
          updatedAt: new Date().toISOString()  // Actualizar la fecha de modificación
        })
        .where(eq(environments.id, id))
        .returning()
        .execute();
        // Si se incluyen instancias, manejar el ciclo completo (crear/actualizar/eliminar)
      if (instancesData && Array.isArray(instancesData)) {
        // 2. Crear un conjunto de IDs de instancias recibidas para verificación rápida
        const receivedInstanceIds = new Set(
          instancesData
            .filter(instance => instance.id && !instance.id.toString().startsWith('instance-'))
            .map(instance => instance.id)
        );
        
        // 3. Eliminar instancias que ya no están en la lista recibida
        for (const existingInstance of currentInstances) {
          if (!receivedInstanceIds.has(existingInstance.id)) {
            await tx
              .delete(instances)
              .where(eq(instances.id, existingInstance.id))
              .execute();
            logger.debug(`Instance ${existingInstance.id} deleted from environment ${id}`);
          }
        }
        
        // 4. Actualizar instancias existentes o crear nuevas
        for (const instance of instancesData) {
          // Si es un ID válido (no temporal) y existe, actualizar
          if (instance.id && !instance.id.toString().startsWith('instance-')) {
            // Actualizar instancia existente
            await tx
              .update(instances)
              .set({
                name: instance.name,
                hostId: instance.hostId || '',
                isPrimary: instance.isPrimary,
                status: instance.status,
                updatedAt: new Date().toISOString()
              })
              .where(eq(instances.id, instance.id))
              .execute();
            logger.debug(`Instance ${instance.id} updated`);
          } else if (instance.name && instance.hostId) {
            // Crear nueva instancia (ignora IDs temporales del cliente)
            await tx
              .insert(instances)
              .values({
                id: uuidv4(),
                environmentId: id,
                name: instance.name,
                hostId: instance.hostId,
                isPrimary: instance.isPrimary || false,
                status: instance.status || 'Running',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              })
              .execute();
            logger.debug(`New instance ${instance.name} created for environment ${id}`);
          }
        }
      }
      
      // Si se incluyen estadísticas de features, actualizar o crear
      if (featureStatsData && Array.isArray(featureStatsData)) {
        for (const feature of featureStatsData) {
          if (feature.id && feature.id > 0) {
            // Actualizar feature existente
            await tx
              .update(featureStats)
              .set({
                name: feature.name,
                currentlyUsed: feature.currentlyUsed,
                detectedUsages: feature.detectedUsages,
                firstUsageDate: feature.firstUsageDate,
                lastUsageDate: feature.lastUsageDate,
                updatedAt: new Date().toISOString()
              })
              .where(eq(featureStats.id, feature.id))
              .execute();
          } else {
            // Crear nuevo feature
            await tx
              .insert(featureStats)
              .values({
                environmentId: id,
                name: feature.name,
                currentlyUsed: feature.currentlyUsed || false,
                detectedUsages: feature.detectedUsages || 0,
                firstUsageDate: feature.firstUsageDate,
                lastUsageDate: feature.lastUsageDate,
                updatedAt: new Date().toISOString()
              })
              .execute();
          }
        }
      }
      
      return updatedEnv[0];
    });
    
    logger.info(`Environment ${id} updated successfully`);
    res.json(updatedEnvironment);
  } catch (error) {
    if ((error as any)?.validation) {
      return res.status((error as any).status || 400).json({
        error: (error as Error).message,
        validation: (error as any).validation,
      });
    }

    logger.error({ error, environmentId: id }, 'Error updating environment');
    next(error);
  }
});

// Schema para validar parámetros en la ruta de eliminación
const deleteEnvironmentSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'ID del entorno es requerido')
  }),
  body: z.object({}).optional(),
  query: z.object({}).optional()
});

/**
 * IMPORTANTE: Las rutas aquí NO deben incluir el prefijo '/api' ya que eso se agrega
 * cuando se monta el router en index.ts
 * 
 * Endpoint para eliminar un entorno y todos los datos asociados
 */
router.delete('/:id', validateRequest(deleteEnvironmentSchema), async (req, res, next) => {
  const { id } = req.params;
  
  logger.debug({ id, user: req.user, path: req.path }, 'Delete environment request received');
  
  try {
    // Usar withTransaction para garantizar la consistencia de los datos
    await withTransaction(async (tx) => {
      // Verificar que el entorno existe
      const environment = await tx
        .select()
        .from(environments)
        .where(eq(environments.id, id))
        .execute();
        
      if (!environment.length) {
        const error: any = new Error('Environment not found');
        error.status = 404;
        throw error;
      }
      
      // Validar permisos del usuario
      const user = req.user as any;
      const isAdmin = user?.role === 'admin';
      // Para usuarios con rol "customer", el ID del cliente está en user.id
      const userCustomerId = user.role === 'customer' ? user.id : user.customerId;
      
      // Solo admins o usuarios del mismo cliente pueden eliminar
      if (!isAdmin && environment[0].customerId !== userCustomerId) {
        logger.warn({ 
          isAdmin, 
          environmentCustomerId: environment[0].customerId, 
          userCustomerId 
        }, 'Permission denied for environment deletion');
        
        const error: any = new Error('Unauthorized access to environment');
        error.status = 403;
        throw error;
      }
      
      // Eliminar entidades relacionadas en orden para mantener integridad referencial
      
      // 1. Eliminar las estadísticas de features
      await tx.delete(featureStats)
        .where(eq(featureStats.environmentId, id))
        .execute();
      
      // 2. Eliminar los PDbs si existen
      await tx.delete(pdbs)
        .where(eq(pdbs.environmentId, id))
        .execute();
      
      // 3. Eliminar las instancias
      await tx.delete(instances)
        .where(eq(instances.environmentId, id))
        .execute();
      
      // 4. Finalmente eliminar el entorno
      await tx.delete(environments)
        .where(eq(environments.id, id))
        .execute();
    });
    
    logger.info(`Environment ${id} deleted successfully`);
    res.json({ success: true, message: 'Environment and all associated data deleted successfully' });
  } catch (error) {
    logger.error({ error, environmentId: id }, 'Error deleting environment');
    next(error);
  }
});

// Schema para validar parámetros en la ruta de clonación
const cloneEnvironmentSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'ID del entorno es requerido')
  }),
  body: z.object({
    newName: z.string().min(1, 'El nuevo nombre es requerido')
  }),
  query: z.object({}).optional()
});

/**
 * IMPORTANTE: Las rutas aquí NO deben incluir el prefijo '/api' ya que eso se agrega
 * cuando se monta el router en index.ts
 * 
 * Endpoint para clonar un entorno
 */
router.post('/:id/clone', validateRequest(cloneEnvironmentSchema), async (req, res, next) => {
  const { id } = req.params;
  const { newName } = req.body;
  
  try {
    // Agregar log detallado para depuración
    logger.debug({ 
      id, 
      newName,
      user: req.user,
      path: req.path
    }, 'Cloning environment request received');
    
    // Validar que el usuario tiene permisos para acceder a este entorno
    const user = req.user as any;
    
    // Si no hay usuario, rechazar la solicitud (no debería ocurrir con el middleware de autenticación)
    if (!user) {
      logger.warn('No user object found in request');
      const error: any = new Error('Authentication required');
      error.status = 401;
      throw error;
    }
    
    const isAdmin = user.role === 'admin';
    // IMPORTANTE: Para usuarios con rol "customer", el ID del cliente está en user.id, no en user.customerId
    const userCustomerId = user.role === 'customer' ? user.id : user.customerId;
    
    // Usar transacción para la operación completa
    const clonedEnvironment = await withTransaction(async (tx) => {
      // Obtener el entorno a clonar
      const environmentToClone = await tx.select()
        .from(environments)
        .where(eq(environments.id, id))
        .execute();
      
      if (!environmentToClone.length) {
        logger.warn(`Environment with ID ${id} not found`);
        const error: any = new Error('Environment not found');
        error.status = 404;
        throw error;
      }
      
      // Validar permisos: solo admins o usuarios del mismo cliente pueden clonar
      if (!isAdmin && environmentToClone[0].customerId !== userCustomerId) {
        logger.warn({ 
          isAdmin, 
          environmentCustomerId: environmentToClone[0].customerId, 
          userCustomerId 
        }, 'Permission denied for environment cloning');
        
        const error: any = new Error('Unauthorized access to environment');
        error.status = 403;
        throw error;
      }

      // Crear un nuevo entorno basado en el original (sin el ID)
      const { id: _, ...environmentData } = environmentToClone[0];
      
      // Insertar el nuevo entorno con un nuevo UUID
      const cloned = await tx.insert(environments)
        .values({
          id: uuidv4(),
          ...environmentData,
          name: newName
        })
        .returning()
        .execute();
      
      return cloned[0];
    });
    
    // Devolver el entorno clonado
    logger.info({ 
      originalId: id, 
      clonedId: clonedEnvironment.id 
    }, 'Environment cloned successfully');
    
    res.status(201).json(clonedEnvironment);
    
  } catch (error) {
    logger.error({ error, environmentId: req.params.id }, 'Error cloning environment');
    next(error);
  }
});

export default router;
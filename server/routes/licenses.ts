import { Router } from 'express';
import { z } from 'zod';
import db from '../database';
import { hosts, licenses, coreAssignments, coreLicenseMappings } from '../../shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { safeOperation, withTransaction } from '../utils/error-handler';
import logger from '../utils/logger';
import { validateRequest } from '../middlewares/validationMiddleware';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Schema para validar parámetros en la ruta de eliminación
const deleteLicenseSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'ID de la licencia es requerido')
  }),
  body: z.object({}).optional(),
  query: z.object({}).optional()
});

// Schema para validar parámetros en la creación de licencia
const createLicenseSchema = z.object({
  params: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({
    customerId: z.string().min(1, 'Customer ID es requerido'),
    product: z.string().min(1, 'Producto es requerido'),
    edition: z.string().optional(),
    licenseType: z.string().optional(),
    metric: z.string().min(1, 'Métrica de licencia es requerida'),
    quantity: z.number().int().nonnegative().default(0),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    status: z.string().optional(),
    csi: z.string().optional(),
    comments: z.string().optional(),
    hostIds: z.array(z.string()).optional()
  })
});

// Schema para validar parámetros en la actualización de licencia
const updateLicenseSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'ID de la licencia es requerido')
  }),
  query: z.object({}).optional(),
  body: z.object({
    product: z.string().optional(),
    edition: z.string().optional(),
    licenseType: z.string().optional(),
    metric: z.string().optional(),
    quantity: z.number().int().nonnegative().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    status: z.string().optional(),
    csi: z.string().optional(),
    comments: z.string().optional(),
    hostIds: z.array(z.string()).optional(),
    customerId: z.string().optional()
  })
});

const assignmentStateSchema = z.object({
  params: z.object({
    licenseId: z.string().min(1, 'ID de la licencia es requerido'),
    hostId: z.string().min(1, 'ID del host es requerido')
  }),
  query: z.object({}).optional(),
  body: z.object({}).optional()
});

interface CoreData {
  coreId: number;
  licenses: string[];
  physicalCoreId?: number;
}

function getUserCustomerId(user: any): string | undefined {
  return user?.role === 'customer' ? user.id : user?.customerId;
}

function calculateMaxSelectableCores(license: any, host: any): number | null {
  if (license.metric === 'Processor') {
    const coreFactor = host.coreFactor && host.coreFactor > 0 ? host.coreFactor : 0.5;
    return Math.max(0, Math.floor((license.quantity || 0) / coreFactor));
  }

  if (license.metric === 'Named User Plus') {
    return Math.max(0, Math.floor((license.quantity || 0) / 2));
  }

  return null;
}

function deriveLicenseType(metric?: string, existingLicenseType?: string): string {
  if (existingLicenseType === 'Application User') {
    return existingLicenseType;
  }

  return metric === 'Named User Plus' ? 'Named User Plus' : 'Processor';
}

/**
 * IMPORTANTE: Las rutas aquí NO deben incluir el prefijo '/api' ya que eso se agrega
 * cuando se monta el router en index.ts
 *
 * Endpoint para eliminar una licencia y limpiar todas sus referencias
 * Mueve la lógica de limpieza de referencias desde el cliente al servidor
 */
router.delete('/:id', validateRequest(deleteLicenseSchema), async (req, res, next) => {
  const { id } = req.params;
  
  logger.debug({ id, user: req.user, path: req.path }, 'Delete license request received');
  
  try {
    await withTransaction(async (tx) => {
      // Verificar que la licencia existe
      const license = await tx.select()
        .from(licenses)
        .where(eq(licenses.id, id))
        .execute();
      
      if (!license.length) {
        const error: any = new Error('License not found');
        error.status = 404;
        throw error;
      }
      
      // Validar que el usuario tiene acceso a esta licencia
      const user = req.user as any;
      const isAdmin = user?.role === 'admin';
      // IMPORTANTE: Para usuarios con rol "customer", el ID del cliente está en user.id, no en user.customerId
      const userCustomerId = user.role === 'customer' ? user.id : user.customerId;
      
      if (!isAdmin && license[0].customerId !== userCustomerId) {
        logger.warn({
          isAdmin,
          licenseCustomerId: license[0].customerId,
          userCustomerId
        }, 'Permission denied for license deletion');
        
        const error: any = new Error('Unauthorized access to license');
        error.status = 403;
        throw error;
      }
      
      // Obtener todos los hosts para limpiar referencias
      const allHosts = await tx.select().from(hosts).execute();
      
      // Para cada host, limpiar las referencias a esta licencia en coreArray
      for (const host of allHosts) {
        let updated = false;
        
        if (host.coreArray && Array.isArray(host.coreArray)) {
          const updatedCoreArray = host.coreArray.map((core: any) => {
            if (core.licenses && Array.isArray(core.licenses)) {
              // Filtrar la licencia que se va a eliminar
              const filteredLicenses = core.licenses.filter((licId: string) => licId !== id);
              
              // Si hay cambios, marcar para actualización
              if (filteredLicenses.length !== core.licenses.length) {
                updated = true;
                return { ...core, licenses: filteredLicenses };
              }
            }
            return core;
          });
          
          // Si se hicieron cambios, actualizar el host
          if (updated) {
            await tx.update(hosts)
              .set({ coreArray: updatedCoreArray })
              .where(eq(hosts.id, host.id))
              .execute();
          }
        }
        
        // Manejar el campo licenseIds para compatibilidad con versiones anteriores
        if (host.licenseIds && Array.isArray(host.licenseIds)) {
          const filteredLicenseIds = host.licenseIds.filter((licId: string) => licId !== id);
          
          if (filteredLicenseIds.length !== host.licenseIds.length) {
            await tx.update(hosts)
              .set({ licenseIds: filteredLicenseIds })
              .where(eq(hosts.id, host.id))
              .execute();
          }
        }
      }
      
      // Eliminar mappings de core_license_mappings que referencian esta licencia
      await tx.delete(coreLicenseMappings).where(eq(coreLicenseMappings.licenseId, id)).execute();
      
      // Finalmente eliminar la licencia
      await tx.delete(licenses).where(eq(licenses.id, id)).execute();
    });
    
    logger.debug(`License ${id} deleted successfully and all references cleaned`);
    res.json({ success: true, message: 'License deleted and all references cleaned' });
  } catch (error) {
    logger.error({ error, licenseId: id }, 'Error deleting license');
    next(error);
  }
});

/**
 * Endpoint para crear una nueva licencia
 */
router.post('/', validateRequest(createLicenseSchema), async (req, res, next) => {
  try {
    logger.debug({ user: req.user, body: req.body, path: req.path }, 'Create license request received');
    
    const licenseData = req.body;
    
    // Validar que el usuario tiene acceso a este cliente
    const user = req.user as any;
    const isAdmin = user?.role === 'admin';
    // IMPORTANTE: Para usuarios con rol "customer", el ID del cliente está en user.id, no en user.customerId
    const userCustomerId = user.role === 'customer' ? user.id : user.customerId;
    
    if (!isAdmin && licenseData.customerId !== userCustomerId) {
      logger.warn({
        isAdmin,
        licenseCustomerId: licenseData.customerId,
        userCustomerId
      }, 'Permission denied for license creation');
      
      return res.status(403).json({ error: 'No tienes permiso para crear licencias para este cliente' });
    }
    
    // Generar un ID único para la nueva licencia
    const licenseId = uuidv4();
    const licenseType = deriveLicenseType(licenseData.metric, licenseData.licenseType);
    
    // Crear la licencia con los campos proporcionados
    const newLicense = {
      id: licenseId,
      customerId: licenseData.customerId,
      product: licenseData.product,
      edition: licenseData.edition,
      licenseType,
      metric: licenseData.metric,
      quantity: licenseData.quantity,
      startDate: licenseData.startDate,
      endDate: licenseData.endDate,
      status: licenseData.status || 'Active',
      csi: licenseData.csi,
      comments: licenseData.comments,
    };
    
    // Insertar la nueva licencia en la base de datos
    await db.insert(licenses).values(newLicense).execute();
    
    // Si hay hostIds, actualizar las referencias
    if (licenseData.hostIds && Array.isArray(licenseData.hostIds) && licenseData.hostIds.length > 0) {
      // En este caso no implementamos la asignación a hosts directamente
      // ya que parece haber un endpoint específico para eso: /:licenseId/assign-to-host/:hostId
      logger.info({ licenseId, hostIds: licenseData.hostIds }, 'License created with hostIds references');
    }
    
    logger.info({ licenseId }, 'License created successfully');
    res.status(201).json({ ...newLicense });
  } catch (error) {
    logger.error({ error }, 'Error creating license');
    next(error);
  }
});

/**
 * Endpoint para actualizar una licencia existente
 */
router.put('/:id', validateRequest(updateLicenseSchema), async (req, res, next) => {
  const { id } = req.params;
  
  try {
    logger.debug({ id, user: req.user, body: req.body, path: req.path }, 'Update license request received');
    
    await withTransaction(async (tx) => {
      // Verificar que la licencia existe
      const license = await tx.select()
        .from(licenses)
        .where(eq(licenses.id, id))
        .execute();
        
      if (!license.length) {
        const error: any = new Error('License not found');
        error.status = 404;
        throw error;
      }
      
      // Validar que el usuario tiene acceso a esta licencia
      const user = req.user as any;
      const isAdmin = user?.role === 'admin';
      const userCustomerId = user.role === 'customer' ? user.id : user.customerId;
      
      if (!isAdmin && license[0].customerId !== userCustomerId) {
        logger.warn({
          isAdmin,
          licenseCustomerId: license[0].customerId,
          userCustomerId
        }, 'Permission denied for license update');
        
        const error: any = new Error('Unauthorized access to license');
        error.status = 403;
        throw error;
      }
      
      // Actualizar solo los campos proporcionados
      const updateData = { ...req.body };

      if (updateData.metric || updateData.licenseType) {
        updateData.licenseType = deriveLicenseType(updateData.metric ?? license[0].metric, updateData.licenseType ?? license[0].licenseType);
      }
      
      // Si se proporciona un customerId y el usuario no es admin, verificar que corresponda
      if (updateData.customerId && !isAdmin && updateData.customerId !== userCustomerId) {
        const error: any = new Error('Cannot change customer assignment as non-admin user');
        error.status = 403;
        throw error;
      }
      
      // Añadir timestamp de actualización
      updateData.updatedAt = new Date().toISOString();
      
      // Actualizar la licencia
      await tx.update(licenses)
        .set(updateData)
        .where(eq(licenses.id, id))
        .execute();
      
      // Obtener la licencia actualizada
      const updatedLicense = await tx.select()
        .from(licenses)
        .where(eq(licenses.id, id))
        .execute();
        
      logger.info({ licenseId: id }, 'License updated successfully');
      res.json(updatedLicense[0]);
    });
  } catch (error) {
    logger.error({ error, licenseId: id }, 'Error updating license');
    next(error);
  }
});

// Get all licenses with optional customerId filter
router.get('/', async (req, res, next) => {
  try {
    logger.debug({ user: req.user, path: req.path, query: req.query }, 'Get licenses request received');
    
    let customerId = req.query.customerId as string | undefined;
    
    // IDOR protection: non-admin users can only see their own data
    const user = req.user as any;
    if (user?.role !== 'admin') {
      customerId = user.id;
    }
    
    let licensesData;
    if (customerId) {
      // If customerId is provided, filter by it
      licensesData = await db
        .select()
        .from(licenses)
        .where(eq(licenses.customerId, customerId))
        .execute();
    } else {
      // Otherwise return all licenses (admin only)
      licensesData = await db
        .select()
        .from(licenses)
        .execute();
    }
    
    res.json(licensesData);
  } catch (error) {
    logger.error({ error, query: req.query }, 'Error fetching licenses');
    next(error);
  }
});

// Get license by ID
router.get('/:id', async (req, res, next) => {
  const { id } = req.params;
  
  logger.debug({ id, user: req.user, path: req.path }, 'Get license by ID request received');
  
  try {
    const license = await db
      .select()
      .from(licenses)
      .where(eq(licenses.id, id))
      .execute();
      
    if (!license.length) {
      return res.status(404).json({ error: 'License not found' });
    }
    
    // IDOR protection: non-admin users can only access their own licenses
    const user = req.user as any;
    if (user?.role !== 'admin' && license[0].customerId !== user.id) {
      return res.status(403).json({ error: 'Unauthorized access to license' });
    }
    
    res.json(license[0]);
  } catch (error) {
    logger.error({ error, licenseId: id }, 'Error fetching license');
    next(error);
  }
});

router.get('/:licenseId/host/:hostId/assignment-state', validateRequest(assignmentStateSchema), async (req, res, next) => {
  const { licenseId, hostId } = req.params;

  try {
    const [licenseResult, hostResult] = await Promise.all([
      db.select().from(licenses).where(eq(licenses.id, licenseId)).execute(),
      db.select().from(hosts).where(eq(hosts.id, hostId)).execute(),
    ]);

    if (!licenseResult.length) {
      return res.status(404).json({ error: 'License not found' });
    }

    if (!hostResult.length) {
      return res.status(404).json({ error: 'Host not found' });
    }

    const license = licenseResult[0];
    const host = hostResult[0];
    const user = req.user as any;
    const userCustomerId = getUserCustomerId(user);
    const userIsAdmin = user?.role === 'admin';

    if (!userIsAdmin && (license.customerId !== userCustomerId || host.customerId !== userCustomerId)) {
      return res.status(403).json({ error: 'Unauthorized access to license assignment state' });
    }

    if (license.customerId !== host.customerId) {
      return res.status(400).json({ error: 'License and host must belong to the same customer' });
    }

    const coreAssignmentResults = await db
      .select({
        id: coreAssignments.id,
        hostId: coreAssignments.hostId,
        coreId: coreAssignments.coreId,
        physicalCoreId: coreAssignments.physicalCoreId,
        licenseId: coreLicenseMappings.licenseId
      })
      .from(coreAssignments)
      .leftJoin(
        coreLicenseMappings,
        eq(coreAssignments.id, coreLicenseMappings.coreAssignmentId)
      )
      .where(eq(coreAssignments.hostId, hostId))
      .execute();

    const selectedCoreIds = coreAssignmentResults
      .filter((assignment) => assignment.licenseId === licenseId)
      .map((assignment) => assignment.coreId)
      .sort((left, right) => left - right);

    const coreMappings = coreAssignmentResults.reduce<Record<number, number>>((accumulator, assignment) => {
      if (assignment.physicalCoreId !== null && assignment.physicalCoreId !== undefined) {
        accumulator[assignment.coreId] = assignment.physicalCoreId;
      }

      return accumulator;
    }, {});

    const physicalHost = host.physicalHostId
      ? (await db.select().from(hosts).where(eq(hosts.id, host.physicalHostId)).execute())[0] ?? null
      : null;

    res.json({
      host: {
        ...host,
        coreAssignments: coreAssignmentResults
      },
      physicalHost,
      selectedCoreIds,
      coreMappings,
      maxSelectableCores: calculateMaxSelectableCores(license, host)
    });
  } catch (error) {
    logger.error({ error, licenseId, hostId }, 'Error fetching license assignment state');
    next(error);
  }
});

/**
 * Gestiona la asignación de una licencia a los cores seleccionados de un host.
 * En caso de particionamiento físico/virtual, también actualiza el host físico.
 * 
 * @param licenseId ID de la licencia a asignar
 * @param hostId ID del host donde se asignará
 * @param selectedCoreIds Array con los IDs de los cores seleccionados
 * @param coreMappings Mapeo de cores virtuales a físicos para particionamiento duro (opcional)
 * @returns El host actualizado
 */
export async function assignLicenseToCores(
  licenseId: string,
  hostId: string,
  selectedCoreIds: number[],
  coreMappings?: Record<number, number>
): Promise<any> {
  return await withTransaction(async (tx) => {
    // 1. Obtener la licencia y validar que existe
    const licenseResult = await tx
      .select()
      .from(licenses)
      .where(eq(licenses.id, licenseId))
      .execute();
      
    if (!licenseResult.length) {
      const error: any = new Error(`Licencia con ID ${licenseId} no encontrada`);
      error.status = 404;
      throw error;
    }
    
    const license = licenseResult[0];
    
    // 2. Obtener el host y validar que existe
    const hostResult = await tx
      .select()
      .from(hosts)
      .where(eq(hosts.id, hostId))
      .execute();
      
    if (!hostResult.length) {
      const error: any = new Error(`Host con ID ${hostId} no encontrado`);
      error.status = 404;
      throw error;
    }
    
    const host = hostResult[0];
      // 3. Obtener las asignaciones de cores existentes para este host
    const existingAssignments = await tx
      .select()
      .from(coreAssignments)
      .where(eq(coreAssignments.hostId, hostId))
      .execute();
    
    // 4a. Obtener todos los mapeos de licencia existentes para esta licencia y host
    const allMappingsForLicenseOnHost = await tx
      .select({
        coreAssignmentId: coreLicenseMappings.coreAssignmentId,
      })
      .from(coreLicenseMappings)
      .innerJoin(
        coreAssignments, 
        eq(coreAssignments.id, coreLicenseMappings.coreAssignmentId)
      )
      .where(
        and(
          eq(coreLicenseMappings.licenseId, licenseId),
          eq(coreAssignments.hostId, hostId)
        )
      )
      .execute();
    
    // 4b. Eliminar TODOS los mapeos de licencia existentes para esta licencia en este host
    // Esto asegura que los cores que ya no están seleccionados pierdan su asignación
    if (allMappingsForLicenseOnHost.length > 0) {
      const allAssignmentIds = allMappingsForLicenseOnHost.map(m => m.coreAssignmentId);
      
      await tx
        .delete(coreLicenseMappings)
        .where(
          and(
            inArray(coreLicenseMappings.coreAssignmentId, allAssignmentIds),
            eq(coreLicenseMappings.licenseId, licenseId)
          )
        )
        .execute();
    }

    // 5. Crear o actualizar las asignaciones de cores
    const newAssignments = [];
    for (const coreId of selectedCoreIds) {
      // Buscar si ya existe una asignación para este core
      let assignment = existingAssignments.find(a => a.coreId === coreId);
      
      if (!assignment) {
        // Si no existe, crear una nueva asignación
        const [newAssignment] = await tx
          .insert(coreAssignments)
          .values({
            hostId,
            coreId,
            physicalCoreId: coreMappings?.[coreId]
          })
          .returning();
        assignment = newAssignment;
      }
      
      // Crear el mapeo de licencia para esta asignación
      await tx
        .insert(coreLicenseMappings)
        .values({
          coreAssignmentId: assignment.id,
          licenseId,
          assignmentDate: new Date().toISOString()
        })
        .execute();

      newAssignments.push(assignment);
    }
    
    // 6. Manejar particionamiento hard si aplica
    let updatedPhysicalHost: any = null;
    
    const isVirtualWithHardPartitioning = 
      host.serverType === 'Virtual' && 
      host.hasHardPartitioning && 
      host.physicalHostId;
      
    if (isVirtualWithHardPartitioning && coreMappings && host.physicalHostId) {
      // 6.1 Obtener el host físico
      const physicalHostResult = await tx
        .select()
        .from(hosts)
        .where(eq(hosts.id, host.physicalHostId))
        .execute();
        
      if (physicalHostResult.length > 0) {
        const physicalHost = physicalHostResult[0];
        
        // 6.2 Obtener las asignaciones existentes del host físico
        const physicalAssignments = await tx
          .select()
          .from(coreAssignments)
          .where(eq(coreAssignments.hostId, host.physicalHostId))
          .execute();

        // 6.3 Eliminar los mapeos de licencia existentes para los cores físicos
        const physicalCoreIds = Object.values(coreMappings);
        const physicalAssignmentIds = physicalAssignments
          .filter(assignment => physicalCoreIds.includes(assignment.coreId))
          .map(assignment => assignment.id);

        if (physicalAssignmentIds.length > 0) {
          await tx
            .delete(coreLicenseMappings)
            .where(
              and(
                inArray(coreLicenseMappings.coreAssignmentId, physicalAssignmentIds),
                eq(coreLicenseMappings.licenseId, licenseId)
              )
            )
            .execute();
        }

        // 6.4 Crear o actualizar las asignaciones de cores físicos
        const newPhysicalAssignments = [];
        for (const physicalCoreId of physicalCoreIds) {
          // Buscar si ya existe una asignación para este core físico
          let physicalAssignment = physicalAssignments.find(a => a.coreId === physicalCoreId);
          
          if (!physicalAssignment) {
            // Si no existe, crear una nueva asignación
            const [newPhysicalAssignment] = await tx
              .insert(coreAssignments)
              .values({
                hostId: host.physicalHostId,
                coreId: physicalCoreId
              })
              .returning();
            physicalAssignment = newPhysicalAssignment;
          }
          
          // Crear el mapeo de licencia para esta asignación física
          await tx
            .insert(coreLicenseMappings)
            .values({
              coreAssignmentId: physicalAssignment.id,
              licenseId,
              assignmentDate: new Date().toISOString()
            })
            .execute();

          newPhysicalAssignments.push(physicalAssignment);
        }
        
        updatedPhysicalHost = {
          ...physicalHost,
          coreAssignments: newPhysicalAssignments
        };
      }
    }
    
    // 7. Obtener todas las asignaciones actualizadas para devolver
    const updatedAssignments = await tx
      .select({
        id: coreAssignments.id,
        hostId: coreAssignments.hostId,
        coreId: coreAssignments.coreId,
        physicalCoreId: coreAssignments.physicalCoreId,
        licenseId: coreLicenseMappings.licenseId
      })
      .from(coreAssignments)
      .leftJoin(
        coreLicenseMappings,
        and(
          eq(coreLicenseMappings.coreAssignmentId, coreAssignments.id),
          eq(coreLicenseMappings.licenseId, licenseId)
        )
      )
      .where(eq(coreAssignments.hostId, hostId))
      .execute();
    
    // 8. Devolver el host actualizado con sus asignaciones
    return {
      ...host,
      coreAssignments: updatedAssignments,
      updatedPhysicalHost
    };
  });
}

/**
 * Endpoint para asignar una licencia a cores específicos de un host
 */
router.post('/:licenseId/assign-to-host/:hostId', async (req, res, next) => {
  const { licenseId, hostId } = req.params;
  const { selectedCoreIds, coreMappings } = req.body;
  
  try {
    logger.debug({ 
      licenseId, 
      hostId, 
      selectedCoreIds,
      user: req.user,
      path: req.path
    }, 'License to cores assignment request received');
    
    if (!selectedCoreIds || !Array.isArray(selectedCoreIds)) {
      return res.status(400).json({ 
        error: 'selectedCoreIds debe ser un array de IDs de cores' 
      });
    }
    
    const result = await assignLicenseToCores(
      licenseId, 
      hostId, 
      selectedCoreIds, 
      coreMappings
    );
    
    logger.info({ licenseId, hostId }, 'License assigned to cores successfully');
    res.json(result);
  } catch (error) {
    logger.error({ error, licenseId, hostId }, 'Error assigning license to cores');
    next(error);
  }
});

/**
 * Endpoint para limpiar todas las asignaciones de licencias
 * Este endpoint elimina todas las referencias a licencias en los hosts
 */
router.post('/clear-license-assignments', async (req, res, next) => {
  try {
    const { customerId } = req.body;
    logger.debug('Clear license assignments request received', { user: req.user, customerId });
    
    if (!customerId) {
      const error = new Error('Customer ID is required');
      (error as any).status = 400;
      throw error;
    }
    
    await withTransaction(async (tx) => {      // 1. Obtener todos los hosts del customer actual que necesitan actualizarse
      const allHosts = await tx
        .select()
        .from(hosts)
        .where(eq(hosts.customerId, customerId))
        .execute();
        
      if (allHosts.length === 0) {
        logger.debug(`No hosts found for customer ${customerId}`);
      }

      // 2. Obtener todos los core_assignments de los hosts del customer actual
      const hostIds = allHosts.map(h => h.id);
      const customerAssignments = await tx
        .select()
        .from(coreAssignments)
        .where(inArray(coreAssignments.hostId, hostIds))
        .execute();

      // 3. Eliminar todos los core_license_mappings para esas asignaciones
      if (customerAssignments.length > 0) {
        logger.debug(`Removing ${customerAssignments.length} core assignments for customer`);
        const assignmentIds = customerAssignments.map(a => a.id);
        await tx
          .delete(coreLicenseMappings)
          .where(inArray(coreLicenseMappings.coreAssignmentId, assignmentIds))
          .execute();
          
        // Opcionalmente, también podemos limpiar las asignaciones de cores ya que no tienen licencias
        await tx
          .delete(coreAssignments)
          .where(inArray(coreAssignments.id, assignmentIds))
          .execute();
      }

      // 4. Para cada host del cliente, limpiar las asignaciones antiguas también (compatibilidad)
      for (const host of allHosts) {
        logger.debug(`Cleaning up legacy assignments for host ${host.id}`);
        
        // Limpiar coreArray (estructura antigua)
        if (host.coreArray && Array.isArray(host.coreArray) && host.coreArray.length > 0) {
          const updatedCoreArray = host.coreArray.map((core: any) => ({
            ...core,
            licenses: []
          }));
          
          await tx.update(hosts)
            .set({ coreArray: updatedCoreArray })
            .where(eq(hosts.id, host.id))
            .execute();
        }
        
        // Limpiar licenseIds (compatibilidad con versiones anteriores)
        if (host.licenseIds && Array.isArray(host.licenseIds) && host.licenseIds.length > 0) {
          await tx.update(hosts)
            .set({ licenseIds: [] })
            .where(eq(hosts.id, host.id))
            .execute();
        }
      }    });
    
    const message = `Successfully cleared all license assignments for customer ${customerId}`;
    logger.info(message);
    res.json({ success: true, message });
    
  } catch (error) {
    logger.error({ error }, 'Error clearing license assignments');
    next(error);
  }
});

export default router;
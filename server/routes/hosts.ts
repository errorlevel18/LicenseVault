import { Router } from 'express';
import { z } from 'zod';
import db from '../database';
import { hosts, coreAssignments, coreLicenseMappings, instances, environments, intCoreFactor } from '../../shared/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq, and, isNotNull, ne, inArray } from 'drizzle-orm';
import { safeOperation, withTransaction } from '../utils/error-handler';
import logger from '../utils/logger';
import { validateRequest } from '../middlewares/validationMiddleware';
import { isAdmin } from '../middlewares/authMiddleware';

const router = Router();

/**
 * Normaliza el tipo de servidor a uno de los tres valores permitidos:
 * 'Physical', 'Virtual' o 'Oracle Cloud'.
 * 
 * @param serverType El tipo de servidor enviado por el cliente
 * @param physicalHostId El ID del host físico (opcional)
 * @returns El tipo de servidor normalizado
 */
export function normalizeServerType(serverType?: string, physicalHostId?: string): 'Physical' | 'Virtual' | 'Oracle Cloud' {
  if (!serverType) {
    // Si no hay tipo de servidor, determinar por si tiene host físico
    return physicalHostId ? 'Virtual' : 'Physical';
  }
  
  const type = serverType.toLowerCase();
  if (type.includes('physical')) {
    return 'Physical';
  } else if (type.includes('virtual')) {
    return 'Virtual';
  } else if (type.includes('cloud') || type.includes('oci') || type.includes('oracle')) {
    return 'Oracle Cloud';
  }
  
  // Valor por defecto
  return physicalHostId ? 'Virtual' : 'Physical';
}

/**
 * Calcula el factor de core basado en el modelo de CPU y otros parámetros
 * 
 * @param cpuModel El modelo de CPU para determinar el factor
 * @param customCoreFactor Factor de core personalizado si se proporciona
 * @param serverType El tipo de servidor
 * @param physicalHostId ID del host físico (solo para hosts virtuales)
 * @param useCache Usar caché de factores (por defecto true)
 * @returns El factor de core calculado
 */
export async function calculateCoreFactor(
  cpuModel: string | undefined, 
  customCoreFactor: number | null = null,
  serverType: 'Physical' | 'Virtual' | 'Oracle Cloud' = 'Physical',
  physicalHostId: string | undefined = undefined,
  useCache: boolean = true
): Promise<number> {
  // Si se proporciona un factor personalizado, utilizarlo directamente
  if (customCoreFactor !== null && !isNaN(customCoreFactor)) {
    logger.debug({ customCoreFactor }, 'Using custom core factor');
    return customCoreFactor;
  }
  
  // Para servidores virtuales, heredar el factor del host físico
  if (serverType === 'Virtual' && physicalHostId) {
    try {
      const physicalHost = await db
        .select()
        .from(hosts)
        .where(eq(hosts.id, physicalHostId))
        .execute();
      
      if (physicalHost.length > 0 && 
          typeof physicalHost[0].coreFactor === 'number' && 
          !isNaN(physicalHost[0].coreFactor)) {
        logger.debug(
          { physicalHostId, coreFactor: physicalHost[0].coreFactor }, 
          'Using core factor inherited from physical host'
        );
        return physicalHost[0].coreFactor;
      }
    } catch (error) {
      logger.warn({ error, physicalHostId }, 'Failed to get physical host core factor');
    }
  }

  // Para hosts físicos, buscar el factor basado en el modelo de CPU
  if (cpuModel) {
    try {
      // Query the int_core_factor reference table for the CPU model
      const exactMatch = await db
        .select()
        .from(intCoreFactor)
        .where(eq(intCoreFactor.cpuModel, cpuModel));

      if (exactMatch.length > 0) {
        logger.debug(
          { cpuModel, coreFactor: exactMatch[0].coreFactor },
          'Using core factor from reference table (exact match)'
        );
        return exactMatch[0].coreFactor;
      }

      // Fallback: partial match against reference table
      const allFactors = await db.select().from(intCoreFactor);
      for (const cf of allFactors) {
        if (cpuModel.toLowerCase().includes(cf.cpuModel.toLowerCase()) ||
            cf.cpuModel.toLowerCase().includes(cpuModel.toLowerCase())) {
          logger.debug(
            { cpuModel, matchedModel: cf.cpuModel, coreFactor: cf.coreFactor },
            'Using core factor from reference table (partial match)'
          );
          return cf.coreFactor;
        }
      }
    } catch (error) {
      logger.warn({ error, cpuModel }, 'Failed to get core factor from reference table');
    }
  }
  
  // Valor por defecto cuando no se pudo determinar el factor
  logger.debug('Using default core factor (0.5)');
  return 0.5;
}

/**
 * Asegura que todos los cores de un host sin hard partitioning
 * están registrados en la tabla core_assignments.
 * Para hosts sin hard partitioning, el physicalCoreId será igual al coreId.
 */
export async function ensureCoreAssignments(
  hostId: string,
  coreCount: number,
  hasHardPartitioning: boolean,
  tx: any
): Promise<void> {
  logger.debug({ 
    hostId, 
    coreCount, 
    hasHardPartitioning,
    hostIdType: typeof hostId,
    coreCountType: typeof coreCount,
    hasHardPartitioningType: typeof hasHardPartitioning,
    txType: typeof tx,
    txIsNull: tx === null,
    txIsUndefined: tx === undefined
  }, 'Iniciando ensureCoreAssignments con parámetros detallados');

  // Validaciones previas para evitar problemas de tipos
  if (!hostId) {
    logger.error('Error: hostId es undefined o null');
    throw new Error('hostId es obligatorio');
  }

  if (coreCount <= 0 || !Number.isInteger(coreCount)) {
    logger.error({ coreCount }, 'Error: coreCount debe ser un entero positivo');
    throw new Error('coreCount debe ser un entero positivo');
  }

  if (tx === null || tx === undefined) {
    logger.error('Error: tx (transacción) es null o undefined');
    throw new Error('tx (transacción) es obligatoria');
  }

  // Si tiene hard partitioning, no hacemos nada - el mapeo se gestiona manualmente
  if (hasHardPartitioning) {
    logger.debug({ hostId }, 'Host tiene hard partitioning, el mapeo se gestiona manualmente');
    return;
  }

  try {
    // Obtener información del host para acceder a physicalHostId si existe
    const hostResult = await tx
      .select()
      .from(hosts)
      .where(eq(hosts.id, hostId))
      .execute();
      
    const physicalHostId = hostResult.length > 0 ? hostResult[0].physicalHostId : null;
    logger.debug({ hostId, physicalHostId }, 'Información de host obtenida para asignación de cores');

    // 1. Eliminar cualquier asignación existente para este host
    logger.debug({ hostId }, 'Eliminando asignaciones previas en la tabla core_assignments');
    await tx
      .delete(coreAssignments)
      .where(eq(coreAssignments.hostId, hostId))      .execute();
        
    // Preparar los valores de asignación de cores
    let coreAssignmentValues;
    // Si es un host virtual (tiene physicalHostId), necesitamos manejar correctamente physicalCoreId
    if (physicalHostId) {
      // Para hosts virtuales, consultamos TODOS los cores del host físico
      const physicalCoresData = await tx
        .select()
        .from(coreAssignments)
        .where(eq(coreAssignments.hostId, physicalHostId))
        .orderBy(coreAssignments.id)
        .execute(); // No limitamos, queremos mapear a todos los cores físicos

      logger.debug({
        physicalHostId,
        physicalCoresFound: physicalCoresData.length,
        physicalCoresFirstRecord: physicalCoresData.length > 0 ? JSON.stringify(physicalCoresData[0]) : 'none'
      }, 'Obteniendo datos de cores físicos para asignar a host virtual');

      // Obtenemos también la información del host físico
      const physicalHostData = await tx
        .select({ cores: hosts.cores, threadsPerCore: hosts.threadsPerCore })
        .from(hosts)
        .where(eq(hosts.id, physicalHostId))
        .limit(1)
        .execute();
        
      const physicalHostCoresCount = physicalHostData.length > 0 ? physicalHostData[0].cores : 0;
        
      logger.debug({ 
        physicalHostId, 
        foundPhysicalCores: physicalCoresData.length,
        physicalTotalCores: physicalHostCoresCount,
        virtualCoreCount: coreCount
      }, 'Cores del host físico para asignar a host virtual');
          // Si no hay suficientes cores físicos, lanzamos error
      if (physicalCoresData.length === 0) {
        logger.error({ 
          physicalHostId, 
          physicalCoresCount: physicalCoresData.length
        }, 'No hay cores físicos disponibles para asignar al host virtual');
        throw new Error('No hay cores físicos disponibles para asignar al host virtual');      }
        // En caso de hosts virtuales sin hard partitioning,
      // simplemente asignamos todos los cores físicos del host físico
      // sin importar cuántas vCPUs haya configurado el usuario
      coreAssignmentValues = [];
        // Mapear los cores físicos directamente a la máquina virtual
      let virtualCoreIndex = 1; // Contador para asignar coreId para el host virtual
      for (const physicalCore of physicalCoresData) {
        // Usamos el coreId del core físico para mantener la referencia al número de core real
        const physicalCoreId = physicalCore.coreId;
        
        coreAssignmentValues.push({
          hostId,
          coreId: virtualCoreIndex, // Asignamos un coreId secuencial para el host virtual
          physicalCoreId, // Usamos el ID real del core físico
          physicalHostId
        });
          
        logger.debug({ 
          hostId,
          virtualCoreId: virtualCoreIndex,
          physicalCoreId,
          physicalCoreOriginalId: physicalCore.id,
          physicalCoreOriginalCoreId: physicalCore.coreId,          physicalCoreOriginalPhysicalCoreId: physicalCore.physicalCoreId,
          physicalHostId
        }, 'Asignando core físico a host virtual');
        
        virtualCoreIndex++; // Incrementamos el contador para el siguiente core
      }
      
      logger.info({ 
        hostId, 
        physicalCoresCount: physicalCoresData.length,
        totalAssignments: coreAssignmentValues.length
      }, `Generando ${coreAssignmentValues.length} mapeos para host virtual sin hard partitioning`);
      
      // Validar que todas las asignaciones sean válidas
      for (const assignment of coreAssignmentValues) {
        if (!assignment.hostId || !assignment.coreId || !assignment.physicalCoreId) {
          logger.error({ assignment }, 'Valores inválidos para asignación de core');
          throw new Error(`Valores inválidos para asignación de core`);
        }
      }
    } else {     
      coreAssignmentValues = Array.from(
        { length: coreCount },
        (_, i) => {
          const coreId = i + 1; // Cores son 1-indexed
          const physicalCoreId = i + 1; // Para hosts físicos, physicalCoreId = coreId
          
          // Validamos cada objeto de asignación antes de devolverlo
          if (!hostId || !coreId) {
            logger.error({ hostId, coreId, physicalCoreId }, 'Valores inválidos para asignación de core');
            throw new Error(`Valores inválidos para asignación de core: hostId=${hostId}, coreId=${coreId}`);
          }
          
          return {
            hostId,
            coreId,
            physicalCoreId: coreId, // Para hosts físicos, physicalCoreId = coreId (su propio ID)
            physicalHostId: hostId // Para hosts físicos, physicalHostId = hostId (su propio ID)
          };
        }
      );
    }
    
    logger.debug({ 
      hostId, 
      assignmentsCount: coreAssignmentValues.length,
      firstAssignment: coreAssignmentValues.length > 0 ? JSON.stringify(coreAssignmentValues[0]) : 'none'
    }, 'Preparando asignaciones automáticas para host sin hard partitioning');
    
    // 3. Insertar las nuevas asignaciones
    if (coreAssignmentValues.length > 0) {
      // Primero intentamos insertar todas las asignaciones a la vez
      try {
        logger.debug({
          hostId,
          batchSize: coreAssignmentValues.length
        }, 'Intentando inserción en lote de asignaciones de core');
        
        await tx
          .insert(coreAssignments)
          .values(coreAssignmentValues)
          .execute();
          
        logger.info({ hostId, count: coreAssignmentValues.length }, 'Asignaciones de core insertadas en lote');
        return;
      } catch (batchError) {
        logger.warn({ 
          error: batchError, 
          hostId,
          message: (batchError as Error).message
        }, 'Error en inserción en lote, intentando una por una');
        
        // Si la inserción en lote falla, intentar una por una para poder identificar la problemática
        for (const assignment of coreAssignmentValues) {
          try {
            logger.debug({ 
              hostId: assignment.hostId, 
              coreId: assignment.coreId, 
              physicalCoreId: assignment.physicalCoreId,
              assignmentStr: JSON.stringify(assignment)
            }, 'Insertando asignación de core individualmente');
            
            // Verificar explícitamente que todos los campos requeridos están presentes
            if (!assignment.hostId) {
              logger.error('Error: hostId es null o undefined en la asignación');
              continue;
            }
            if (!assignment.coreId) {
              logger.error('Error: coreId es null o undefined en la asignación');
              continue;
            }
            
            // Ver estructura exacta del objeto antes de insertarlo
            logger.debug({
              assignmentObj: assignment,
              assignmentJSON: JSON.stringify(assignment),
              hostId_type: typeof assignment.hostId,
              coreId_type: typeof assignment.coreId,
              physicalCoreId_type: typeof assignment.physicalCoreId
            }, 'Detalles completos del objeto de asignación');
            
            await tx
              .insert(coreAssignments)
              .values(assignment)
              .execute();
              
            logger.debug({ hostId, coreId: assignment.coreId }, 
              'Asignación de core insertada correctamente');
          } catch (insertError) {
            const errorMsg = (insertError as Error).message;
            logger.error({ 
              error: insertError,
              hostId,
              assignment: JSON.stringify(assignment),
              errorMessage: errorMsg
            }, 'Error al insertar asignación individual de core');
            
            // Si es un error de restricción NOT NULL, mostrar información detallada
            if (errorMsg.includes('SQLITE_CONSTRAINT_NOTNULL')) {
              logger.error({
                constraint_error: true,
                assignment_values: assignment,
                hostId_exists: assignment.hostId !== undefined && assignment.hostId !== null,
                coreId_exists: assignment.coreId !== undefined && assignment.coreId !== null,
                physicalCoreId_exists: assignment.physicalCoreId !== undefined && assignment.physicalCoreId !== null
              }, 'Error de restricción NOT NULL en asignación de core');
            }
            
            // Continuar con la siguiente asignación en lugar de fallar todo el proceso
          }
        }
      }
      
      logger.info({ hostId, assignmentsCount: coreAssignmentValues.length }, 
        'Proceso de inserción de asignaciones automáticas completado');
    }
    
    // 4. Actualizar también el coreArray para consistencia
    // Solo hacemos esta operación si estamos en una transacción, no en operaciones independientes
    if (tx) {
      const hostResult = await tx
        .select()
        .from(hosts)
        .where(eq(hosts.id, hostId))
        .execute();
        
      if (hostResult.length > 0) {
        const host = hostResult[0];
        
        // Inicializar o actualizar el coreArray del host para mantener la consistencia
        let updatedCoreArray;
        
        if (host.coreArray && Array.isArray(host.coreArray)) {
          // Si ya existe, actualizamos asegurando que todos los cores tienen physicalCoreId
          updatedCoreArray = host.coreArray.map((core: any, index: number) => ({
            ...core,
            physicalCoreId: core.coreId // Para hosts sin hard partitioning, physicalCoreId = coreId
          }));
        } else {
          // Si no existe, lo creamos desde cero
          updatedCoreArray = Array.from(
            { length: coreCount },
            (_, i) => ({ 
              coreId: i + 1, 
              physicalCoreId: i + 1, // Para hosts sin hard partitioning, physicalCoreId = coreId
              licenses: [] as string[] 
            })
          );
        }
        
        // Actualizar el host
        await tx
          .update(hosts)
          .set({ coreArray: updatedCoreArray })
          .where(eq(hosts.id, hostId))
          .execute();
          
        logger.debug({ hostId }, 'Campo coreArray actualizado automáticamente');
      }
    }
  } catch (error) {
    logger.error({ 
      error, 
      hostId,
      errorMessage: (error as Error).message,
      errorStack: (error as Error).stack
    }, 'Error durante la asignación automática de cores');
    throw error;
  }
}

/**
 * Checks if a virtual server is trying to use more cores than its physical host has
 */
export async function validateVirtualHostCores(
  virtualServerCores: number,
  physicalHostId: string | null | undefined
): Promise<{ valid: boolean; message?: string }> {
  if (!physicalHostId || virtualServerCores <= 0) {
    return { valid: true };
  }
  
  try {
    // Get the physical host data
    const physicalHost = await db
      .select()
      .from(hosts)
      .where(eq(hosts.id, physicalHostId))
      .execute();
    
    if (!physicalHost.length) {
      return { valid: false, message: "Physical host not found" };
    }
    
    const physicalHostCores = physicalHost[0].cores || 0;
    
    // Validate that virtual server doesn't use more cores than physical host has
    if (virtualServerCores > physicalHostCores) {
      return { 
        valid: false, 
        message: `Virtual servers cannot have more cores than their physical host (${physicalHostCores} cores)` 
      };
    }
    
    return { valid: true };
  } catch (error) {
    logger.error({ error, physicalHostId }, 'Failed to validate virtual host cores');
    return { valid: false, message: "Error validating core counts" };
  }
}

/**
 * Check if updating a physical host would reduce cores below what virtual hosts are using
 */
export async function validatePhysicalHostCoreReduction(
  hostId: string,
  newCoreCount: number
): Promise<{ valid: boolean; message?: string }> {
  if (newCoreCount <= 0) {
    return { valid: false, message: "Core count must be greater than 0" };
  }
  
  try {
    // Get all virtual hosts that depend on this physical host
    const virtualHosts = await db
      .select()
      .from(hosts)
      .where(
        and(
          eq(hosts.serverType, "Virtual"),
          eq(hosts.physicalHostId, hostId)
        )
      )
      .execute();
    
    if (!virtualHosts.length) {
      return { valid: true }; // No virtual hosts depend on this physical host
    }
    
    // Find the maximum number of cores used by any virtual host
    const maxUsedCores = Math.max(
      ...virtualHosts.map(h => h.cores || 0)
    );
    
    if (newCoreCount < maxUsedCores) {
      return {
        valid: false,
        message: `Cannot reduce core count below ${maxUsedCores}, which is used by dependent virtual hosts`
      };
    }
    
    return { valid: true };
  } catch (error) {
    logger.error({ error, hostId }, 'Failed to validate physical host core reduction');
    return { valid: false, message: "Error validating core reduction" };
  }
}

/**
 * Gestiona el mapeo entre cores para todos los tipos de hosts, incluyendo hosts físicos,
 * virtuales y en la nube. Compatibilidad extendida para todos los tipos de particionamiento.
 *
 * @param hostId ID del host 
 * @param coreMappings Mapeo de cores
 * @returns El host actualizado
 */
export async function manageCoreMapping(
  hostId: string,
  coreMappings: Record<number, number>
): Promise<any> {
  logger.info({ hostId, mappingsCount: Object.keys(coreMappings).length }, 'Iniciando manageCoreMapping');
  
  return await withTransaction(async (tx) => {
    try {
      // 1. Obtener el host
      logger.debug({ hostId }, 'Buscando host');
      const hostResult = await tx
        .select()
        .from(hosts)
        .where(eq(hosts.id, hostId))
        .execute();
  
      if (!hostResult.length) {
        logger.error({ hostId }, 'Host no encontrado');
        const error: any = new Error(`Host con ID ${hostId} no encontrado`);
        error.status = 404;
        throw error;
      }
  
      const host = hostResult[0];
      logger.debug({ hostId, host: { name: host.name, type: host.serverType } }, 'Host encontrado');
        // Verificamos si se está intentando mapear cores manualmente en un host sin hard partitioning
      if (!host.hasHardPartitioning) {
        logger.warn({ hostId }, 'Intento de mapeo manual de cores en un host sin hard partitioning');
        // En lugar de fallar, usamos la función automática
        await ensureCoreAssignments(hostId, host.cores, false, tx);
        
        // Buscar el host actualizado para devolverlo
        const updatedHostResult = await tx
          .select()
          .from(hosts)
          .where(eq(hosts.id, hostId))
          .execute();
          
        // Obtener las asignaciones que acabamos de crear
        const autoAssignments = await tx
          .select()
          .from(coreAssignments)
          .where(eq(coreAssignments.hostId, hostId))
          .execute();
          
        return {
          ...(updatedHostResult[0] || host),
          mappedCoreAssignments: autoAssignments
        };
      }
      
      // Caso especial para hosts virtuales con particionamiento duro
      let physicalHost = null;
      if (host.serverType === 'Virtual' && host.hasHardPartitioning && host.physicalHostId) {
        // Obtener el host físico asociado
        logger.debug({ physicalHostId: host.physicalHostId }, 'Buscando host físico asociado');
        const physicalHostResult = await tx
          .select()
          .from(hosts)
          .where(eq(hosts.id, host.physicalHostId))
          .execute();
        
        if (!physicalHostResult.length) {
          logger.error({ physicalHostId: host.physicalHostId }, 'Host físico no encontrado');
          const error: any = new Error(`Host físico con ID ${host.physicalHostId} no encontrado`);
          error.status = 404;
          throw error;
        }
        
        physicalHost = physicalHostResult[0];
        logger.debug({ 
          physicalHostId: host.physicalHostId,
          physicalHost: { name: physicalHost.name, cores: physicalHost.cores }
        }, 'Host físico encontrado');
      }

      // 2. ACTUALIZAR LA TABLA CORE_ASSIGNMENTS
      
      // 2.1 Primero, eliminar cualquier asignación existente para este host
      logger.debug({ hostId }, 'Eliminando asignaciones previas en la tabla core_assignments');
      try {
        const deleteResult = await tx
          .delete(coreAssignments)
          .where(eq(coreAssignments.hostId, hostId))
          .execute();
        
        logger.debug({ hostId, deleteResult }, 'Asignaciones anteriores eliminadas de core_assignments');
      } catch (dbError) {
        logger.error({ 
          error: dbError, 
          hostId,
          errorMessage: (dbError as Error).message,
          stack: (dbError as Error).stack
        }, 'Error al eliminar asignaciones previas en la tabla core_assignments');
        throw dbError;
      }      // 2.2 Preparar nuevas asignaciones basadas en el mapeo
      // Antes de crear asignaciones, vamos a obtener los datos de los cores físicos
      let physicalCoresData: any[] = [];
      if (host.serverType === 'Virtual' && host.hasHardPartitioning && host.physicalHostId) {
        // Para hosts virtuales con hard partitioning, necesitamos los IDs reales de los cores físicos
        physicalCoresData = await tx
          .select({
            id: coreAssignments.id,
            coreId: coreAssignments.coreId,
            physicalCoreId: coreAssignments.physicalCoreId
          })
          .from(coreAssignments)
          .where(eq(coreAssignments.hostId, host.physicalHostId))
          .execute();

        logger.debug({
          physicalHostId: host.physicalHostId,
          physicalCoresFound: physicalCoresData.length,
          physicalCoresData: JSON.stringify(physicalCoresData)
        }, 'Cores físicos encontrados para mapeo con hard partitioning');
      }

      // Crear el mapa de [coreId físico] -> [id de asignación] para búsquedas rápidas
      const physicalCoreMap = new Map();
      physicalCoresData.forEach(core => {
        physicalCoreMap.set(core.coreId, {
          id: core.id, 
          physicalCoreId: core.physicalCoreId
        });
        logger.debug({
          coreId: core.coreId,
          id: core.id,
          physicalCoreId: core.physicalCoreId
        }, 'Adding physical core to map');
      });

      // Ahora preparar las asignaciones
      const coreAssignmentValues = Object.entries(coreMappings)
        .filter(([_, physicalCoreId]) => parseInt(String(physicalCoreId)) > 0) // Filtrar solo las asignaciones válidas
        .map(([virtualCoreId, physicalCoreId]) => {
          const physicalCoreIdNumber = parseInt(String(physicalCoreId));
          
          // Si tenemos un mapeo y el core existe en el host físico, usar su información
          let actualPhysicalCoreId = physicalCoreIdNumber;
          const physicalCoreInfo = physicalCoreMap.get(physicalCoreIdNumber);
          
          // Para hosts con hard partitioning, necesitamos usar el ID real del core físico
          if (host.hasHardPartitioning && physicalCoreMap.has(physicalCoreIdNumber)) {
            // Si el core físico tiene su propio physicalCoreId, lo usamos (para mantener la cadena de asignación)
            if (physicalCoreInfo && physicalCoreInfo.physicalCoreId) {
              actualPhysicalCoreId = physicalCoreInfo.physicalCoreId;
            }
          }
          
          logger.debug({
            virtualCoreId: parseInt(virtualCoreId),
            requestedPhysicalCoreId: physicalCoreIdNumber,
            actualPhysicalCoreId,
            hasMapping: physicalCoreMap.has(physicalCoreIdNumber),
            physicalCoreInfo: physicalCoreInfo ? JSON.stringify(physicalCoreInfo) : null
          }, 'Preparando asignación de core para host con hard partitioning');
          
          return {
            hostId: hostId,
            coreId: parseInt(virtualCoreId),
            physicalCoreId: actualPhysicalCoreId, // ID real del core físico al que se mapea
            physicalHostId: host.physicalHostId // Guardar también el physicalHostId cuando aplica
          };
        });
      
      logger.debug({ 
        hostId, 
        assignmentsCount: coreAssignmentValues.length, 
        values: JSON.stringify(coreAssignmentValues)
      }, 'Preparando nuevas asignaciones para la tabla core_assignments');
      
      // 2.3 Insertar las nuevas asignaciones si hay alguna
      if (coreAssignmentValues.length > 0) {
        try {
          // Intentar inserción uno por uno para manejar posibles errores de restricción UNIQUE
          for (const assignment of coreAssignmentValues) {
            try {
              const insertResult = await tx
                .insert(coreAssignments)
                .values(assignment)
                .execute();
                
              logger.debug({ hostId, coreId: assignment.coreId, physicalCoreId: assignment.physicalCoreId }, 
                'Asignación de core insertada correctamente');
            } catch (insertError) {
              logger.error({ 
                error: insertError,
                hostId,
                assignment,
                errorMessage: (insertError as Error).message
              }, 'Error al insertar asignación de core individual');
              // Continuar con la siguiente asignación
            }
          }
          logger.info({ hostId, assignmentsCount: coreAssignmentValues.length }, 
            'Proceso de inserción de asignaciones completado');
        } catch (dbError) {
          logger.error({ 
            error: dbError, 
            hostId, 
            errorMessage: (dbError as Error).message,
            stack: (dbError as Error).stack
          }, 'Error fatal al insertar asignaciones en la tabla core_assignments');
          throw dbError;
        }
      } else {
        logger.info({ hostId }, 'No hay asignaciones válidas para insertar en core_assignments');
      }

      // 3. Para compatibilidad con el resto de la aplicación (campo coreArray)
      // inicializamos o actualizamos el coreArray si existe
      if (host.coreArray && Array.isArray(host.coreArray)) {
        logger.debug({ hostId }, 'Actualizando coreArray para compatibilidad');
        const updatedCoreArray = host.coreArray.map((core: any) => {
          const coreId = core.coreId;
          const physicalCoreId = coreMappings[coreId];
          
          if (physicalCoreId !== undefined && physicalCoreId > 0) {
            return {
              ...core,
              physicalCoreId
            };
          } else {
            // Si no hay mapeo, eliminar la referencia física si existiera
            const { physicalCoreId, ...restCore } = core;
            return restCore;
          }
        });

        try {
          await tx
            .update(hosts)
            .set({ coreArray: updatedCoreArray })
            .where(eq(hosts.id, hostId))
            .execute();
          
          logger.debug({ hostId }, 'Campo coreArray actualizado exitosamente en la tabla hosts');
        } catch (dbError) {
          logger.error({ 
            error: dbError, 
            hostId, 
            errorMessage: (dbError as Error).message
          }, 'Error al actualizar coreArray en la tabla hosts');
          // No lanzamos error aquí porque este paso es solo para compatibilidad
        }
      }

      // 4. Obtener las asignaciones que acabamos de crear para devolverlas
      const createdAssignments = await tx
        .select()
        .from(coreAssignments)
        .where(eq(coreAssignments.hostId, hostId))
        .execute();
      
      logger.info({ hostId, createdAssignmentsCount: createdAssignments.length }, 
        'Mapeo de cores completado exitosamente');
      
      // 5. Devolución del resultado
      return {
        ...host,
        mappedCoreAssignments: createdAssignments
      };
    } catch (error) {
      logger.error({ 
        error, 
        hostId,
        errorMessage: (error as Error).message,
        stack: (error as Error).stack
      }, 'Error durante el mapeo de cores');
      throw error;
    }
  });
}

/**
 * IMPORTANTE: Las rutas aquí NO deben incluir el prefijo '/api' ya que eso se agrega
 * cuando se monta el router en index.ts
 * 
 * Definir rutas estáticas antes de las rutas con parámetros
 * para evitar problemas de captura incorrecta.
 */

// Schema para validar la creación de host
const createHostSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
    serverType: z.enum(['Physical', 'Virtual', 'Oracle Cloud']),
    virtualizationType: z.string().optional(),
    cpuModel: z.string().min(1, 'El modelo de CPU es obligatorio'),
    sockets: z.number().int().min(1, 'Debe tener al menos 1 socket'),
    cores: z.number().int().min(1, 'Debe tener al menos 1 core'),
    threadsPerCore: z.number().int().min(1, 'Debe tener al menos 1 thread por core'),
    physicalHostId: z.string().optional(),
    customerId: z.string().min(1, 'ID del cliente es requerido'),
    coreFactor: z.number().optional(),
    hasHardPartitioning: z.boolean().optional(),
    coreArray: z.any().optional()
  }),
  query: z.object({}).optional()
});

/**
 * Endpoint para crear un nuevo host
 */
router.post('/', validateRequest(createHostSchema), async (req, res, next) => {
  try {
    logger.debug({ body: req.body, user: req.user, path: req.path }, 'Create host request received');

    // Validar permisos del usuario
    const user = req.user as any;
    const isAdmin = user?.role === 'admin';
    // Para usuarios con rol "customer", el ID del cliente está en user.id
    const userCustomerId = user?.role === 'customer' ? user.id : user?.customerId;

    // Solo admins o usuarios del mismo cliente pueden crear hosts
    if (!isAdmin && req.body.customerId !== userCustomerId) {
      logger.warn({
        isAdmin,
        requestCustomerId: req.body.customerId,
        userCustomerId
      }, 'Permission denied for host creation');

      const error: any = new Error('Unauthorized to create host for this customer');
      error.status = 403;
      throw error;
    }
    
    // Validate that virtual servers don't have more cores than their physical host
    if (req.body.serverType === 'Virtual' && req.body.physicalHostId) {
      // Validar el número de cores
      const coreValidation = await validateVirtualHostCores(req.body.cores, req.body.physicalHostId);
      if (!coreValidation.valid) {
        logger.warn({
          virtualServerCores: req.body.cores,
          physicalHostId: req.body.physicalHostId,
          message: coreValidation.message
        }, 'Virtual server core validation failed');
        
        return res.status(400).json({ error: coreValidation.message });
      }
      
      // Validar la consistencia del tipo de virtualización
      const virtualizationTypeValidation = await validateVirtualizationTypeConsistency(
        req.body.virtualizationType,
        req.body.physicalHostId
      );
      
      if (!virtualizationTypeValidation.valid) {
        logger.warn({
          virtualizationType: req.body.virtualizationType,
          physicalHostId: req.body.physicalHostId,
          requiredType: virtualizationTypeValidation.requiredType,
          message: virtualizationTypeValidation.message
        }, 'Virtualization type consistency validation failed');
        
        return res.status(400).json({ 
          error: virtualizationTypeValidation.message,
          requiredType: virtualizationTypeValidation.requiredType 
        });
      }
    }

    // Normalizar el tipo de servidor si es necesario
    const serverType = normalizeServerType(req.body.serverType, req.body.physicalHostId);
    
    // Calcular el factor de core si no se proporciona
    const coreFactor = req.body.coreFactor !== undefined ? 
      req.body.coreFactor : 
      await calculateCoreFactor(
        req.body.cpuModel, 
        null,
        serverType,
        req.body.physicalHostId
      );    // Preparar los datos del host
    const hostData = {
      id: uuidv4(),
      name: req.body.name,
      serverType,
      virtualizationType: req.body.virtualizationType || null,
      cpuModel: req.body.cpuModel, // Ahora es obligatorio por la validación del schema
      sockets: req.body.sockets,
      cores: req.body.cores,
      threadsPerCore: req.body.threadsPerCore,
      physicalHostId: req.body.physicalHostId || null,
      customerId: req.body.customerId,
      coreFactor,
      hasHardPartitioning: req.body.hasHardPartitioning || false,
      coreArray: req.body.coreArray || null
    };

    // Insertar el nuevo host    // Usar transacción para asegurar que el host y sus asignaciones de cores se crean juntos
    const result = await withTransaction(async (tx) => {
      // Insertar el nuevo host
      const newHost = await tx
        .insert(hosts)
        .values(hostData)
        .returning()
        .execute();      // Para hosts sin hard partitioning, crear automáticamente core_assignments
      if (!hostData.hasHardPartitioning) {
        logger.debug({ 
          newHostId: newHost[0]?.id || 'undefined', 
          cores: hostData.cores,
          hasHP: hostData.hasHardPartitioning 
        }, 'Preparando creación de core assignments');
        
        // Verificar que tenemos todos los datos necesarios
        if (!newHost[0] || !newHost[0].id) {
          logger.error('Error: No se pudo crear core_assignments porque el ID del nuevo host es undefined');
        } else if (!hostData.cores || hostData.cores <= 0) {
          logger.error({ cores: hostData.cores }, 'Error: No se pudo crear core_assignments porque el número de cores no es válido');
        } else {
          try {
            await ensureCoreAssignments(
              newHost[0].id,
              hostData.cores,
              hostData.hasHardPartitioning,
              tx
            );
            logger.debug({ hostId: newHost[0].id }, 'Core assignments creados automáticamente');
          } catch (coreError) {
            logger.error({ 
              error: coreError, 
              hostId: newHost[0].id, 
              errorMessage: (coreError as Error).message 
            }, 'Error al crear core assignments');
            // No propagamos el error para no interrumpir la creación del host
          }
        }
      }
      
      return newHost;
    });

    logger.info({ hostId: result[0].id }, 'Host created successfully');
    res.status(201).json(result[0]);
  } catch (error) {
    logger.error({ error }, 'Error creating host');
    next(error);
  }
});

// Get all hosts with optional customerId filter
router.get('/', async (req, res, next) => {
  try {
    logger.debug({ user: req.user, path: req.path, query: req.query }, 'Get hosts request received');
    
    let customerId = req.query.customerId as string | undefined;
    
    // IDOR protection: non-admin users can only see their own data
    const user = req.user as any;
    if (user?.role !== 'admin') {
      customerId = user.id;
    }
    
    let hostsData;
    if (customerId) {
      // If customerId is provided, filter by it
      hostsData = await db
        .select()
        .from(hosts)
        .where(eq(hosts.customerId, customerId))
        .execute();
    } else {
      // Otherwise return all hosts (admin only)
      hostsData = await db
        .select()
        .from(hosts)
        .execute();
    }
    
    // Enriquecer los hosts con información actualizada de asignación de licencias
    const enrichedHosts = await Promise.all(hostsData.map(async (host) => {
      try {
        // Obtener todas las asignaciones de cores para este host
        const coreAssignmentsData = await db
          .select({
            id: coreAssignments.id,
            coreId: coreAssignments.coreId,
            physicalCoreId: coreAssignments.physicalCoreId
          })
          .from(coreAssignments)
          .where(eq(coreAssignments.hostId, host.id))
          .execute();
        
        // Para cada asignación de core, obtener las licencias asignadas
        const coreArray = await Promise.all(coreAssignmentsData.map(async (assignment) => {
          // Obtener todas las licencias asignadas a este core
          const licenseMappings = await db
            .select({
              licenseId: coreLicenseMappings.licenseId
            })
            .from(coreLicenseMappings)
            .where(eq(coreLicenseMappings.coreAssignmentId, assignment.id))
            .execute();
            // Devolver el objeto CoreLicenseAssignment actualizado
          return {
            coreId: assignment.coreId,
            // Si physicalCoreId es null, usamos coreId como valor por defecto
            // Esto asegura que siempre tengamos un valor válido
            physicalCoreId: assignment.physicalCoreId !== null ? assignment.physicalCoreId : assignment.coreId,
            licenses: licenseMappings.map(mapping => mapping.licenseId)
          };
        }));
        
        // Si no hay asignaciones existentes, inicializar el coreArray con cores vacíos
        if (coreArray.length === 0 && host.cores) {
          // Crear coreArray desde cero
          return {
            ...host,
            coreArray: Array.from(
              { length: host.cores || 0 },
              (_, i) => ({ 
                coreId: i + 1, 
                physicalCoreId: i + 1,
                licenses: [] as string[] 
              })
            )
          };
        }
        
        // Retornar host con coreArray actualizado
        return {
          ...host,
          coreArray
        };
      } catch (error) {
        logger.error({ hostId: host.id, error }, 'Error enriching host with core assignments');
        // Si hay error, devolver el host original
        return host;
      }
    }));
    
    logger.debug(`Get all hosts request successful with enriched core data`);
    res.json(enrichedHosts);
  } catch (error) {
    logger.error({ error, query: req.query }, 'Error fetching hosts');
    next(error);
  }
});

// Get host by ID
router.get('/:id', async (req, res, next) => {
  const { id } = req.params;
  
  logger.debug({ id, user: req.user, path: req.path }, 'Get host by ID request received');
  
  try {
    // 1. Get the host data
    const host = await db
      .select()
      .from(hosts)
      .where(eq(hosts.id, id))
      .execute();
      
    if (!host.length) {
      return res.status(404).json({ error: 'Host not found' });
    }
    
    // IDOR protection: non-admin users can only access their own hosts
    const user = req.user as any;
    if (user?.role !== 'admin' && host[0].customerId !== user.id) {
      return res.status(403).json({ error: 'Unauthorized access to host' });
    }
    
    // 2. Get core assignments for this host, with their license mappings
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
      .where(eq(coreAssignments.hostId, id))
      .execute();
    
    // 3. Return host with included core assignments
    const result = {
      ...host[0],
      coreAssignments: coreAssignmentResults
    };
    
    logger.info(`Get host ${id} request successful with ${coreAssignmentResults.length} core assignments`);
    res.json(result);
  } catch (error) {
    logger.error({ error, hostId: id }, 'Error fetching host');
    next(error);
  }
});

// Schema para validar la actualización de host
const updateHostSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'ID del host es requerido')
  }),
  body: z.object({
    name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres').optional(),
    serverType: z.enum(['Physical', 'Virtual', 'Oracle Cloud']).optional(),
    virtualizationType: z.string().optional().nullable(),
    cpuModel: z.string().optional().nullable(),
    sockets: z.number().int().min(1, 'Debe tener al menos 1 socket').optional(),
    cores: z.number().int().min(1, 'Debe tener al menos 1 core').optional(),
    threadsPerCore: z.number().int().min(1, 'Debe tener al menos 1 thread por core').optional(),
    physicalHostId: z.string().optional().nullable(),
    coreFactor: z.number().optional(),
    hasHardPartitioning: z.boolean().optional(),
    coreArray: z.any().optional().nullable()
  }),
  query: z.object({}).optional()
});

/**
 * Endpoint para actualizar un host existente
 */
router.put('/:id', validateRequest(updateHostSchema), async (req, res, next) => {
  const { id } = req.params;
  
  try {
    logger.debug({ id, body: req.body, user: req.user, path: req.path }, 'Update host request received');
    
    // Verificar que el host existe y obtener sus datos actuales
    const existingHost = await db
      .select()
      .from(hosts)
      .where(eq(hosts.id, id))
      .execute();
      
    if (!existingHost.length) {
      return res.status(404).json({ error: 'Host not found' });
    }
    
    // Validar permisos del usuario
    const user = req.user as any;
    const isAdmin = user?.role === 'admin';
    // Para usuarios con rol "customer", el ID del cliente está en user.id
    const userCustomerId = user?.role === 'customer' ? user.id : user?.customerId;
    
    // Solo admins o usuarios del mismo cliente pueden actualizar hosts
    if (!isAdmin && existingHost[0].customerId !== userCustomerId) {
      logger.warn({ 
        isAdmin, 
        hostCustomerId: existingHost[0].customerId, 
        userCustomerId 
      }, 'Permission denied for host update');
      
      return res.status(403).json({ error: 'Unauthorized to update this host' });
    }
    
    // Validar consistencia del tipo de virtualización si se está actualizando un host virtual
    // o si se está cambiando de físico a virtual
    const isVirtualOrChangingToVirtual = 
      existingHost[0].serverType === 'Virtual' || 
      (req.body.serverType === 'Virtual' || (req.body.physicalHostId && req.body.physicalHostId !== existingHost[0].physicalHostId));
    
    const physicalHostIdToCheck = req.body.physicalHostId !== undefined ? 
      req.body.physicalHostId : existingHost[0].physicalHostId;
      
    const virtualizationTypeToCheck = req.body.virtualizationType !== undefined ? 
      req.body.virtualizationType : existingHost[0].virtualizationType;
    
    if (isVirtualOrChangingToVirtual && physicalHostIdToCheck) {
      // Validar la consistencia del tipo de virtualización
      const virtualizationTypeValidation = await validateVirtualizationTypeConsistency(
        virtualizationTypeToCheck,
        physicalHostIdToCheck
      );
      
      if (!virtualizationTypeValidation.valid) {
        logger.warn({
          id,
          virtualizationType: virtualizationTypeToCheck,
          physicalHostId: physicalHostIdToCheck,
          requiredType: virtualizationTypeValidation.requiredType,
          message: virtualizationTypeValidation.message
        }, 'Virtualization type consistency validation failed');
        
        return res.status(400).json({ 
          error: virtualizationTypeValidation.message,
          requiredType: virtualizationTypeValidation.requiredType 
        });
      }
    }
    
    // Normalizar el tipo de servidor si se proporciona
    let serverType = existingHost[0].serverType as 'Physical' | 'Virtual' | 'Oracle Cloud';
    
    // Log para depuración
    logger.debug(`Host update - server type before: ${serverType}, request serverType: ${req.body.serverType}`);
    
    if (req.body.serverType !== undefined) {
      serverType = normalizeServerType(
        req.body.serverType, 
        req.body.physicalHostId !== undefined ? req.body.physicalHostId : existingHost[0].physicalHostId
      );
      logger.debug(`Host update - normalized server type: ${serverType}`);
    } else {
      logger.debug(`Host update - keeping existing serverType: ${serverType}`);
    }
    // Validar si se está intentando reducir el número de cores cuando hay licencias asignadas
    if (req.body.cores !== undefined && req.body.cores < existingHost[0].cores) {      // Identificar qué cores específicos se están eliminando
      const currentCores = existingHost[0].cores;
      const newCores = req.body.cores;
      const coresToRemove = Array.from(
        { length: currentCores - newCores },
        (_, i) => newCores + i + 1
      );
      
      logger.debug({ 
        hostId: id, 
        currentCores, 
        newCores, 
        coresToRemove 
      }, 'Cores que se eliminarán en esta operación');
      
      // Verificar si alguno de los cores específicos que se eliminan tiene licencias asignadas en coreArray
      const coreArray = (existingHost[0] as any).coreArray;
      let coresWithLicensesInCoreArray: number[] = [];
      
      if (coreArray && Array.isArray(coreArray)) {
        coresWithLicensesInCoreArray = coreArray
          .filter(core => 
            core && 
            core.coreId && 
            coresToRemove.includes(core.coreId) && 
            core.licenses && 
            Array.isArray(core.licenses) && 
            core.licenses.length > 0
          )
          .map(core => core.coreId);
      }
      
      // Verificar si alguno de los cores específicos que se eliminan tiene licencias asignadas en la tabla core_assignments
      const coreAssignmentResult = await db
        .select({
          coreId: coreAssignments.coreId,
          assignmentId: coreAssignments.id,
        })
        .from(coreAssignments)
        .where(eq(coreAssignments.hostId, id))
        .execute();
      
      // Obtener los IDs de asignación para verificar si tienen licencias mapeadas
      const assignmentIdsToCheck = coreAssignmentResult
        .filter(ca => coresToRemove.includes(ca.coreId))
        .map(ca => ca.assignmentId);
      
      let coresWithLicensesInAssignmentTable: number[] = [];
      
      if (assignmentIdsToCheck.length > 0) {
        // Verificar cuáles de estos cores tienen licencias asignadas
        const licenseMappings = await db
          .select({
            coreAssignmentId: coreLicenseMappings.coreAssignmentId,
          })
          .from(coreLicenseMappings)
          .where(inArray(coreLicenseMappings.coreAssignmentId, assignmentIdsToCheck))
          .execute();
        
        const assignmentIdsWithLicenses = new Set(licenseMappings.map(lm => lm.coreAssignmentId));
        
        coresWithLicensesInAssignmentTable = coreAssignmentResult
          .filter(ca => assignmentIdsWithLicenses.has(ca.assignmentId) && coresToRemove.includes(ca.coreId))
          .map(ca => ca.coreId);
      }
      
      // Combinar los resultados de ambas verificaciones
      const allCoresWithLicenses = Array.from(
        new Set([...coresWithLicensesInCoreArray, ...coresWithLicensesInAssignmentTable])
      );
      
      // Si hay cores con licencias asignadas entre los que se van a eliminar, impedir la reducción
      if (allCoresWithLicenses.length > 0) {
        logger.warn({ 
          hostId: id, 
          currentCores: existingHost[0].cores,
          requestedCores: newCores,
          coresToRemove,
          coresWithLicenses: allCoresWithLicenses
        }, 'Attempted to reduce cores that have licenses assigned');
        
        return res.status(400).json({ 
          error: `No se pueden eliminar los cores ${allCoresWithLicenses.join(', ')} porque tienen licencias asignadas`
        });
      }
      
      // If this is a physical host being updated, check that it's not reducing cores
      // below what any of its virtual hosts are using
      if (existingHost[0].serverType === "Physical") {
        const validation = await validatePhysicalHostCoreReduction(id, req.body.cores);
        if (!validation.valid) {
          logger.warn({ 
            hostId: id, 
            currentCores: existingHost[0].cores,
            requestedCores: req.body.cores,
            message: validation.message
          }, 'Physical host core reduction validation failed');
          
          return res.status(400).json({ error: validation.message });
        }
      }
    }
    
    // If this is a virtual host being updated, validate cores against physical host
    if (existingHost[0].serverType === "Virtual" && req.body.cores) {
      const physicalHostId = req.body.physicalHostId || existingHost[0].physicalHostId;
      
      if (physicalHostId) {
        const validation = await validateVirtualHostCores(req.body.cores, physicalHostId);
        if (!validation.valid) {
          logger.warn({
            virtualServerCores: req.body.cores,
            physicalHostId: physicalHostId,
            message: validation.message
          }, 'Virtual server core validation failed');
          
          return res.status(400).json({ error: validation.message });
        }
      }
    }

    // Calcular el factor de core si es necesario
    let coreFactor = existingHost[0].coreFactor;
    if (req.body.coreFactor !== undefined) {
      coreFactor = req.body.coreFactor;
    } else if (req.body.cpuModel || req.body.serverType || req.body.physicalHostId) {
      // Recalcular si cambian los parámetros que afectan al factor
      coreFactor = await calculateCoreFactor(
        req.body.cpuModel || existingHost[0].cpuModel,
        null,
        serverType,
        req.body.physicalHostId !== undefined ? req.body.physicalHostId : existingHost[0].physicalHostId
      );
    }
    
    // Preparar los datos a actualizar
    const updateData = {
      ...req.body,
      serverType,
      coreFactor
    };
    
    // Eliminar campos que no deben actualizarse
    delete updateData.id;
    delete updateData.customerId;
      // Actualizar el host y sus core mappings en una transacción
    const result = await withTransaction(async (tx) => {
      // Actualizar el host
      const updatedHost = await tx
        .update(hosts)
        .set(updateData)
        .where(eq(hosts.id, id))
        .returning()
        .execute();
        // Manejo especial para cambios en hard partitioning
      const oldHasHP = existingHost[0].hasHardPartitioning || false;
      const newHasHP = updateData.hasHardPartitioning !== undefined ? updateData.hasHardPartitioning : oldHasHP;
      
      // Caso 1: Host sin hard partitioning (sea nuevo o existente sin HP)
      // Caso 2: Host que cambia de tener HP a no tenerlo (requiere regenerar los mappings automáticos)
      if (!newHasHP || (oldHasHP && !newHasHP)) {
        
        // Usamos los nuevos valores de cores si se modificaron, o los originales si no
        const coreCount = updateData.cores !== undefined ? updateData.cores : existingHost[0].cores;
        
        // El hasHardPartitioning puede haber cambiado o no
        const hasHP = updateData.hasHardPartitioning !== undefined ? 
          updateData.hasHardPartitioning : existingHost[0].hasHardPartitioning;
          
        await ensureCoreAssignments(
          id,
          coreCount,
          hasHP,
          tx
        );
        logger.debug({ hostId: id }, 'Core assignments actualizados automáticamente');
      }
      
      return updatedHost;
    });
    
    logger.info({ hostId: id }, 'Host updated successfully');
    res.json(result[0]);
  } catch (error) {
    logger.error({ error, hostId: id }, 'Error updating host');
    next(error);
  }
});

/**
 * Endpoint para limpiar todas las asignaciones de licencias
 */
// Removed clear-license-assignments endpoint - moved to licenses.ts

// Schema para validar parámetros en la ruta de clonación
const cloneHostSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'ID del host es requerido')
  }),
  body: z.object({
    newName: z.string().min(1, 'El nuevo nombre es requerido'),
    cloneVirtualHosts: z.boolean().optional().default(false)
  }),
  query: z.object({}).optional()
});

/**
 * Endpoint para clonar un host
 */
router.post('/:id/clone', validateRequest(cloneHostSchema), async (req, res, next) => {
  const { id } = req.params;
  const { newName, cloneVirtualHosts } = req.body;
  
  try {
    // Agregar log detallado para depuración
    logger.debug({ 
      id, 
      newName, 
      cloneVirtualHosts,
      user: req.user,
      path: req.path
    }, 'Cloning host request received');
    
    // Validar que el usuario tiene permisos para acceder a este host
    const user = req.user as any;
    
    // Si no hay usuario, rechazar la solicitud (no debería ocurrir con el middleware de autenticación)
    if (!user) {
      logger.warn('No user object found in request');
      const error: any = new Error('Authentication required');
      error.status = 401;
      throw error;
    }
    
    const isAdmin = user.role === 'admin';
    // Fix: Properly check for user.customerId property and provide a fallback
    const userCustomerId = isAdmin ? null : (user.customerId || user.id || null);
    
    // Ejecutar todo el proceso de clonación dentro de una transacción
    const result = await withTransaction(async (tx) => {
      // Obtener el host a clonar
      const hostToClone = await tx.select()
        .from(hosts)
        .where(eq(hosts.id, id))
        .execute();
      
      if (!hostToClone.length) {
        logger.warn(`Host with ID ${id} not found`);
        const error: any = new Error('Host not found');
        error.status = 404;
        throw error;
      }
      
      // Validar permisos: solo admins o usuarios del mismo cliente pueden clonar
      if (!isAdmin && hostToClone[0].customerId !== userCustomerId) {
        logger.warn({ 
          isAdmin, 
          hostCustomerId: hostToClone[0].customerId, 
          userCustomerId 
        }, 'Permission denied for host cloning');
        
        const error: any = new Error('Unauthorized access to host');
        error.status = 403;
        throw error;
      }

      // Crear un nuevo host basado en el original
      const { id: _, ...hostData } = hostToClone[0];
      
      // Insertar un nuevo ID para el host clonado
      const clonedHostId = uuidv4();
      
      // Insertar el nuevo host con los datos del original
      const clonedHost = await tx.insert(hosts)
        .values({
          id: clonedHostId,
          ...hostData,
          name: newName
        })
        .returning()
        .execute();
          // Si el host no tiene hard partitioning, crear los core_assignments automáticamente
      if (!hostData.hasHardPartitioning) {
        await ensureCoreAssignments(
          clonedHostId,
          hostData.cores,
          hostData.hasHardPartitioning,
          tx
        );
        logger.debug({ hostId: clonedHostId }, 'Core assignments creados automáticamente para host clonado');
      } else {
        // Para hosts con hard partitioning, no creamos core_assignments automáticamente
        // ya que estos se manejan manualmente mediante la función de mapeo de cores
        logger.debug({ hostId: clonedHostId, hasHardPartitioning: true }, 'Host clonado tiene hard partitioning, no se crean core_assignments automáticos');
      }
      
      // Almacenar todas las VMs clonadas para devolverlas al cliente
      const clonedVms = [];
      
      // Si es un host físico y se solicita clonar VMs
      if (cloneVirtualHosts && hostToClone[0].serverType === 'Physical') {
        // Buscar todas las VMs que dependen de este host
        const dependentVMs = await tx.select()
          .from(hosts)
          .where(
            and(
              eq(hosts.serverType, 'Virtual'),
              eq(hosts.physicalHostId, id)
            )
          )
          .execute();
        
        // Clonar cada VM
        for (const vm of dependentVMs) {
          const { id: vmId, ...vmData } = vm;
          const vmName = vm.name.split('-').pop() || 'VM';
          const newVmName = `${clonedHost[0].name}-${vmName}`;
            // Generar un nuevo ID para la VM clonada
          const clonedVmId = uuidv4();
          
          // Insertar la VM clonada
          const clonedVm = await tx.insert(hosts)
            .values({
              id: clonedVmId,
              ...vmData,
              name: newVmName,
              physicalHostId: clonedHost[0].id
            })
            .returning()
            .execute();
              // Si la VM no tiene hard partitioning, crear los core_assignments automáticamente
          if (!vmData.hasHardPartitioning) {
            await ensureCoreAssignments(
              clonedVmId,
              vmData.cores,
              vmData.hasHardPartitioning,
              tx
            );
            logger.debug({ hostId: clonedVmId }, 'Core assignments creados automáticamente para VM clonada');
          } else {
            // Para VMs con hard partitioning, no creamos core_assignments automáticamente
            // ya que estas se manejan manualmente mediante la función de mapeo de cores
            logger.debug({ hostId: clonedVmId, hasHardPartitioning: true }, 'VM clonada tiene hard partitioning, no se crean core_assignments automáticos');
          }
          
          clonedVms.push(clonedVm[0]);
        }
      }
      
      return {
        ...clonedHost[0],
        clonedVms
      };
    });
    
    // Devolver el host clonado y las VMs clonadas
    logger.info({
      originalId: id,
      clonedId: result.id,
      clonedVmsCount: result.clonedVms.length
    }, 'Host cloned successfully');
    
    res.status(201).json(result);
    
  } catch (error) {
    logger.error({ error, hostId: req.params.id }, 'Error cloning host');
    next(error);
  }
});

/**
 * Endpoint para obtener el factor de core para un modelo de CPU
 */
router.get('/core-factors/:cpuModel', async (req, res, next) => {
  const { cpuModel } = req.params;
  
  try {
    const coreFactor = await calculateCoreFactor(cpuModel);
    res.json({ cpuModel, coreFactor });
  } catch (error) {
    logger.error({ error, cpuModel }, 'Error fetching core factor');
    next(error);
  }
});

/**
 * Endpoint para gestionar mapeo de cores físicos/virtuales
 */
router.post('/:id/core-mappings', async (req, res, next) => {
  const { id } = req.params;
  const coreMappings = req.body.coreMappings;
  
  try {
    logger.debug({ id, coreMappings, user: req.user }, 'Core mappings update request received');
    
    if (!coreMappings || typeof coreMappings !== 'object') {
      return res.status(400).json({ error: 'Se requiere un objeto de mapeo de cores' });
    }
    
    // IDOR protection: verify host ownership
    const user = req.user as any;
    if (user?.role !== 'admin') {
      const hostCheck = await db.select({ customerId: hosts.customerId })
        .from(hosts).where(eq(hosts.id, id)).execute();
      if (!hostCheck.length || hostCheck[0].customerId !== user.id) {
        return res.status(403).json({ error: 'Unauthorized access to host' });
      }
    }
    
    const updatedHost = await manageCoreMapping(id, coreMappings);
    
    logger.info({ hostId: id }, 'Core mappings updated successfully');
    res.json(updatedHost);
  } catch (error) {
    logger.error({ error, hostId: id }, 'Error updating core mappings');
    next(error);
  }
});

/**
 * Endpoint para obtener las asignaciones de cores de un host
 */
router.get('/:id/core-assignments', async (req, res, next) => {
  const { id } = req.params;
  
  try {
    logger.debug({ id, user: req.user }, 'Get core assignments request received');
    
    // 1. Primero obtenemos el host para verificar su existencia y tipo
    const hostResult = await db
      .select()
      .from(hosts)
      .where(eq(hosts.id, id))
      .execute();
      
    if (!hostResult.length) {
      return res.status(404).json({ error: 'Host not found' });
    }
    
    // IDOR protection: non-admin users can only access their own hosts
    const user = req.user as any;
    if (user?.role !== 'admin' && hostResult[0].customerId !== user.id) {
      return res.status(403).json({ error: 'Unauthorized access to host' });
    }
    
      const host = hostResult[0];
    let physicalHostId = null;
    
    // Para hosts virtuales con host físico, obtenemos el ID del host físico
    if (host.serverType === 'Virtual' && host.physicalHostId) {
      physicalHostId = host.physicalHostId;
    } else if (host.serverType === 'Physical') {
      // Para hosts físicos, physicalHostId = hostId (su propio ID)
      physicalHostId = id;
    }
    
    // 2. Obtener las asignaciones de cores específicas para este host virtual
    const assignments = await db
      .select()
      .from(coreAssignments)
      .where(eq(coreAssignments.hostId, id))
      .execute();
      // 3. Para hosts virtuales con host físico, obtener TODAS las asignaciones de cores en el mismo host físico
    // Esto nos permitirá mostrar y bloquear cores ya utilizados por otras VMs
    let allVirtualHosts = [];
    let otherVirtualHostIds = [];
    let otherAssignments: Record<number, Array<{hostId: string, hostName: string, coreId: number}>> = {};
    
    if (physicalHostId) {
      allVirtualHosts = await db
        .select()
        .from(hosts)
        .where(
          and(
            eq(hosts.physicalHostId, physicalHostId),
            eq(hosts.serverType, 'Virtual')
          )
        )
        .execute();
        
      otherVirtualHostIds = allVirtualHosts
        .filter(h => h.id !== id)
        .map(h => h.id);
        
      // Obtener asignaciones de cores de otras VMs que usan el mismo host físico
      if (otherVirtualHostIds.length > 0) {
        // Para cada host virtual, obtener sus asignaciones
        for (const otherVmId of otherVirtualHostIds) {
          const vmAssignments = await db
            .select()
            .from(coreAssignments)
            .where(eq(coreAssignments.hostId, otherVmId))
            .execute();
            
          // Obtener el nombre del host para mostrarlo en la UI
          const vmHost = allVirtualHosts.find(h => h.id === otherVmId);
            // Guardar las asignaciones con referencia al host que las usa
          vmAssignments.forEach(assignment => {
            // Initialize array if it doesn't exist
            if (!otherAssignments[assignment.physicalCoreId]) {
              otherAssignments[assignment.physicalCoreId] = [];
            }
            
            // Add the assignment to the array for this physical core
            otherAssignments[assignment.physicalCoreId].push({
              hostId: otherVmId,
              hostName: vmHost?.name || 'Unknown VM',
              coreId: assignment.coreId
            });
          });
        }
      }
    }    // 4. Convertir los resultados propios a un formato más fácil de usar por el cliente
    // Formato: {virtualCoreId: physicalCoreId}
    const mappings: Record<number, number> = {};
    assignments.forEach(assignment => {
      // Nos aseguramos de utilizar el physical_core_id correcto para cada asignación
      // Para hard partitioning, physical_core_id debe ser el valor real del core físico
      // Valor por defecto: si physicalCoreId es null, usamos el core_id (como ocurre con hosts físicos)
      mappings[assignment.coreId] = assignment.physicalCoreId !== null ? assignment.physicalCoreId : assignment.coreId;

      // Agregamos log para depuración
      logger.debug({ 
        virtualCoreId: assignment.coreId, 
        physicalCoreId: assignment.physicalCoreId, 
        mappedTo: mappings[assignment.coreId]
      }, `Mapeando core virtual ${assignment.coreId} a core físico`);
    });
      // Logs diferentes para hosts virtuales vs otros tipos
    if (physicalHostId) {
      logger.info({ 
        hostId: id, 
        physicalHostId,
        hostType: host.serverType,
        assignmentsCount: assignments.length,
        otherAssignmentsCount: Object.keys(otherAssignments).length,
        otherVirtualHostsCount: otherVirtualHostIds.length
      }, 'Core assignments fetched successfully for virtual host');
    } else {
      logger.info({ 
        hostId: id, 
        hostType: host.serverType,
        assignmentsCount: assignments.length
      }, 'Core assignments fetched successfully for non-virtual host');
    }
      res.json({ 
      assignments, 
      mappings, 
      physicalHostId, // Para hosts físicos, physicalHostId = hostId (su propio ID)
      hostType: host.serverType,
      // Incluimos información sobre cores ya utilizados por otras VMs (solo para virtuales)
      usedPhysicalCores: otherAssignments 
    });
  } catch (error) {
    logger.error({ error, hostId: id }, 'Error fetching core assignments');
    next(error);
  }
});

/**
 * Schema para validar la solicitud de eliminación de host
 */
const deleteHostSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'ID del host es requerido')
  }),
  body: z.object({}).optional(),
  query: z.object({}).optional()
});

// Delete all hosts for a customer (must be before /:id to avoid matching "all" as an id)
router.delete('/all', async (req, res, next) => {
  try {
    const user = req.user as any;
    const isAdminUser = user?.role === 'admin';
    const customerId = req.query.customerId as string;
    if (!customerId) {
      return res.status(400).json({ error: 'customerId query parameter is required' });
    }
    const userCustomerId = user.role === 'customer' ? user.id : user.customerId;
    if (!isAdminUser && customerId !== userCustomerId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await withTransaction(async (tx) => {
      const customerHosts = await tx.select({ id: hosts.id }).from(hosts).where(eq(hosts.customerId, customerId)).execute();
      if (customerHosts.length === 0) return { deleted: 0 };
      const hostIds = customerHosts.map(h => h.id);

      // Delete core license mappings
      const hostCoreAssignments = await tx.select({ id: coreAssignments.id }).from(coreAssignments).where(inArray(coreAssignments.hostId, hostIds)).execute();
      if (hostCoreAssignments.length > 0) {
        await tx.delete(coreLicenseMappings).where(inArray(coreLicenseMappings.coreAssignmentId, hostCoreAssignments.map(a => a.id))).execute();
      }
      await tx.delete(coreAssignments).where(inArray(coreAssignments.hostId, hostIds)).execute();
      await tx.delete(instances).where(inArray(instances.hostId, hostIds)).execute();
      // Virtual hosts first to avoid FK constraint on physical_host_id
      await tx.delete(hosts).where(and(eq(hosts.customerId, customerId), isNotNull(hosts.physicalHostId))).execute();
      await tx.delete(hosts).where(eq(hosts.customerId, customerId)).execute();

      return { deleted: customerHosts.length };
    });

    logger.info(`Deleted all ${result.deleted} hosts for customer ${customerId}`);
    res.json({ success: true, deleted: result.deleted });
  } catch (error) {
    logger.error({ error }, 'Error deleting all hosts');
    next(error);
  }
});

/**
 * Endpoint para eliminar un host
 */
router.delete('/:id', validateRequest(deleteHostSchema), async (req, res, next) => {
  const { id } = req.params;
  
  logger.debug({ id, user: req.user, path: req.path }, 'Delete host request received');
  
  try {
    // Usar withTransaction para garantizar la consistencia de los datos
    await withTransaction(async (tx) => {
      // Verificar que el host existe
      const host = await tx
        .select()
        .from(hosts)
        .where(eq(hosts.id, id))
        .execute();
        
      if (!host.length) {
        const error: any = new Error('Host not found');
        error.status = 404;
        throw error;
      }
      
      // Validar permisos del usuario
      const user = req.user as any;
      const isAdmin = user?.role === 'admin';
      // Para usuarios con rol "customer", el ID del cliente está en user.id
      const userCustomerId = user.role === 'customer' ? user.id : user.customerId;
      
      // Solo admins o usuarios del mismo cliente pueden eliminar
      if (!isAdmin && host[0].customerId !== userCustomerId) {
        logger.warn({ 
          isAdmin, 
          hostCustomerId: host[0].customerId, 
          userCustomerId 
        }, 'Permission denied for host deletion');
        
        const error: any = new Error('Unauthorized access to host');
        error.status = 403;
        throw error;
      }
        // Verificar si hay hosts virtuales asociados
      const virtualHosts = await tx
        .select()
        .from(hosts)
        .where(eq(hosts.physicalHostId, id))
        .execute();
        
      if (virtualHosts.length > 0) {
        const error: any = new Error(`Cannot delete host because it is the physical host for ${virtualHosts.length} virtual machines`);
        error.status = 400;
        throw error;
      }
      
      // Verificar si hay instancias asignadas a este host
      const hostInstances = await tx
        .select({
          id: instances.id,
          name: instances.name,
          environmentId: instances.environmentId
        })
        .from(instances)
        .where(eq(instances.hostId, id))
        .execute();
        
      if (hostInstances.length > 0) {
        // Obtener los nombres de los entornos afectados
        const environmentIds = Array.from(
          new Set(hostInstances.map(instance => instance.environmentId))
        ).filter((environmentId): environmentId is string => Boolean(environmentId));
        
        const affectedEnvironments = await tx
          .select({
            id: environments.id,
            name: environments.name
          })
          .from(environments)
          .where(inArray(environments.id, environmentIds))
          .execute();
          
        const environmentNames = affectedEnvironments.map(env => env.name);
        
        const error: any = new Error(`Cannot delete host because it has ${hostInstances.length} instances assigned to ${environmentNames.length} environments: ${environmentNames.join(', ')}`);
        error.status = 400;
        throw error;
      }
      
      // Eliminar primero las asignaciones de cores si existen
      await tx.delete(coreAssignments)
        .where(eq(coreAssignments.hostId, id))
        .execute();
      
      // Finalmente eliminar el host
      await tx.delete(hosts)
        .where(eq(hosts.id, id))
        .execute();
    });
    
    logger.info(`Host ${id} deleted successfully`);
    res.json({ success: true, message: 'Host deleted successfully' });
  } catch (error) {
    logger.error({ error, hostId: id }, 'Error deleting host');
    next(error);
  }
});

/**
 * Obtiene los hosts físicos compatibles con un tipo de virtualización específico.
 * Un host físico es compatible si:
 * - No tiene ninguna VM asociada, o
 * - Todas sus VMs asociadas usan el mismo tipo de virtualización especificado
 * 
 * @param virtualizationType El tipo de virtualización deseado
 * @param customerId ID del cliente (opcional, para filtrar por cliente)
 * @param currentHostId ID del host actual (opcional, para excluirlo de la validación)
 * @returns Lista de hosts físicos compatibles
 */
export async function getCompatiblePhysicalHosts(
  virtualizationType: string | null | undefined,
  customerId?: string,
  currentHostId?: string
): Promise<any[]> {
  try {
    // 1. Obtener todos los hosts físicos (opcionalmente filtrando por cliente)
    const whereConditions = [eq(hosts.serverType, 'Physical')];
    
    if (customerId) {
      whereConditions.push(eq(hosts.customerId, customerId));
    }
    
    const physicalHosts = await db
      .select()
      .from(hosts)
      .where(and(...whereConditions))
      .execute();
    
    // Si no hay hosts físicos, retornar lista vacía
    if (!physicalHosts.length) {
      return [];
    }
    
    // 2. Para cada host físico, verificar si es compatible con el tipo de virtualización
    const compatibleHosts = await Promise.all(
      physicalHosts.map(async (physicalHost) => {
        // Buscar hosts virtuales asociados a este host físico
        const whereVirtualConditions = [
          eq(hosts.serverType, 'Virtual'),
          eq(hosts.physicalHostId, physicalHost.id)
        ];
        
        // Excluir el host actual si se proporciona ID
        if (currentHostId) {
          whereVirtualConditions.push(ne(hosts.id, currentHostId));
        }
        
        const virtualHosts = await db
          .select()
          .from(hosts)
          .where(and(...whereVirtualConditions))
          .execute();
        
        // Si no hay hosts virtuales asociados, es compatible
        if (!virtualHosts.length) {
          return {
            ...physicalHost,
            isCompatible: true,
            reason: 'No tiene máquinas virtuales asociadas'
          };
        }
        
        // Si no se especifica tipo de virtualización, es incompatible
        if (!virtualizationType) {
          return {
            ...physicalHost,
            isCompatible: false,
            reason: 'Se requiere especificar un tipo de virtualización'
          };
        }
        
        // Verificar si todos los hosts virtuales asociados usan el mismo tipo de virtualización
        const incompatibleHost = virtualHosts.find(
          vh => vh.virtualizationType && 
               vh.virtualizationType.toLowerCase() !== virtualizationType.toLowerCase()
        );
        
        if (incompatibleHost) {
          return {
            ...physicalHost,
            isCompatible: false,
            reason: `Ya tiene máquinas virtuales que usan ${incompatibleHost.virtualizationType} como tipo de virtualización`,
            currentVirtualizationType: incompatibleHost.virtualizationType
          };
        }
        
        // Si todos usan el mismo tipo, es compatible
        return {
          ...physicalHost,
          isCompatible: true,
          reason: `Compatible con tipo de virtualización ${virtualizationType}`
        };
      })
    );
    
    return compatibleHosts;
  } catch (error) {
    logger.error({ error, virtualizationType }, 'Error getting compatible physical hosts');
    throw error;
  }
}

/**
 * Valida la consistencia del tipo de virtualización para hosts virtuales
 * que comparten el mismo host físico.
 * 
 * @param virtualizationType El tipo de virtualización que se desea usar
 * @param physicalHostId El ID del host físico al que se vinculará el host virtual
 * @returns Un objeto con el resultado de la validación
 */
export async function validateVirtualizationTypeConsistency(
  virtualizationType: string | null | undefined,
  physicalHostId: string | null | undefined
): Promise<{ valid: boolean; message?: string; requiredType?: string }> {
  // Si no es un servidor virtual (no tiene physicalHostId) o no tiene tipo de virtualización,
  // no realizamos validación
  if (!physicalHostId || !virtualizationType) {
    return { valid: true };
  }
  
  try {
    // Buscar otros hosts virtuales que usen el mismo host físico
    const existingVirtualHosts = await db
      .select()
      .from(hosts)
      .where(
        and(
          eq(hosts.physicalHostId, physicalHostId),
          isNotNull(hosts.virtualizationType)
        )
      )
      .execute();
    
    // Si no hay otros hosts virtuales, cualquier tipo de virtualización es válido
    if (!existingVirtualHosts.length) {
      return { valid: true };
    }
    
    // Obtener el tipo de virtualización de los hosts existentes
    const existingType = existingVirtualHosts[0].virtualizationType;
    
    // Verificar si el tipo de virtualización proporcionado coincide con los existentes
    if (existingType && existingType.toLowerCase() !== virtualizationType.toLowerCase()) {
      return { 
        valid: false, 
        message: `El tipo de virtualización debe ser consistente con otros hosts virtuales en el mismo host físico (${existingType})`,
        requiredType: existingType
      };
    }
    
    return { valid: true };
  } catch (error) {
    logger.error({ error, physicalHostId }, 'Error validating virtualization type consistency');
    return { 
      valid: false, 
      message: "Error validando la consistencia del tipo de virtualización"
    };
  }
}

// Get compatible physical hosts for a virtualization type
router.get('/compatible-physical-hosts', async (req, res, next) => {
  try {
    const { virtualizationType, customerId, currentHostId } = req.query;
    
    logger.debug({ 
      virtualizationType, 
      customerId, 
      currentHostId,
      user: req.user
    }, 'Get compatible physical hosts request received');
    
    // Validar permisos del usuario si se especifica un customerId
    if (customerId) {
      const user = req.user as any;
      const isAdmin = user?.role === 'admin';
      // Para usuarios con rol "customer", el ID del cliente está en user.id
      const userCustomerId = user?.role === 'customer' ? user.id : user?.customerId;
      
      // Solo admins o usuarios del mismo cliente pueden ver hosts de ese cliente
      if (!isAdmin && customerId !== userCustomerId) {
        logger.warn({ 
          isAdmin, 
          requestCustomerId: customerId, 
          userCustomerId 
        }, 'Permission denied for getting hosts by customer');
        
        return res.status(403).json({ error: 'Unauthorized to view hosts for this customer' });
      }
    }
    
    // Obtener hosts físicos compatibles
    const compatibleHosts = await getCompatiblePhysicalHosts(
      virtualizationType as string | undefined,
      customerId as string | undefined,
      currentHostId as string | undefined
    );
    
    // Filtrar para devolver solo los hosts compatibles si se especifica un tipo de virtualización
    const filteredHosts = virtualizationType
      ? compatibleHosts.filter(host => host.isCompatible)
      : compatibleHosts;
    
    logger.info(
      `Returning ${filteredHosts.length} compatible physical hosts for virtualization type ${virtualizationType || 'any'}`
    );
    
    res.json(filteredHosts);
  } catch (error) {
    logger.error({ error, query: req.query }, 'Error getting compatible physical hosts');
    next(error);
  }
});

export default router;
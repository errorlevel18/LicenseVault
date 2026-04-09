import { Router } from 'express';
import { isAdmin } from '../middlewares/authMiddleware';
import db from '../database';
import logger from '../utils/logger';
import { safeOperation } from '../utils/error-handler';
import { eq, or, and } from 'drizzle-orm';
import { 
  intDatabaseEdition, intEnvironmentType, 
  intMultiTenant, intCoreFactor, intDatabaseVersions,
  intPrimaryUse, intVirtualizationTypes, intLicenseProducts
} from '../../shared/schema';

const router = Router();

// Get license products from the database
router.get('/licenseProducts', async (req, res, next) => {
  try {
    // Obtener el parámetro type de la consulta y dividirlo en un array si existe
    const typeFilter = req.query.type ? String(req.query.type).split(',') : null;
    const onlyEnterprise = req.query.onlyEnterprise === 'true';
      // Usar safeOperation con una consulta personalizada
    const data = await safeOperation(
      async () => {
        // Construimos las condiciones primero
        const conditions = [];
        
        // Si se proporciona un filtro de tipo, crear condición OR para cada tipo
        if (typeFilter && typeFilter.length > 0) {
          conditions.push(
            typeFilter.map(type => 
              eq(intLicenseProducts.type, type)
            ).reduce((acc, condition, index) => 
              index === 0 ? condition : or(acc, condition)
            )
          );
        }
        
        // Filtrar por onlyEnterprise si se especifica
        if (onlyEnterprise) {
          conditions.push(eq(intLicenseProducts.onlyEnterprise, true));
        }
        
        // Construir la consulta con todas las condiciones a la vez
        let query;
        if (conditions.length === 0) {
          query = db.select().from(intLicenseProducts);
        } else if (conditions.length === 1) {
          query = db.select().from(intLicenseProducts).where(conditions[0]);
        } else {
          // Si hay múltiples condiciones, las combinamos con AND
          query = db.select().from(intLicenseProducts).where(and(...conditions));
        }
        
        return await query.execute();
      },
      'Error fetching license products'
    );
    
    res.json(data);
  } catch (error) {
    logger.error({ error, typeFilter: req.query.type }, 'Error fetching license products');
    next(error);
  }
});

// Get all reference data items from a table
router.get('/:tableName', async (req, res, next) => {
  const { tableName } = req.params;

  try {
    let data;

    switch (tableName) {
      case 'environmentTypes':
        data = await db.select().from(intEnvironmentType).execute();
        break;
      case 'databaseEditions':
        data = await db.select().from(intDatabaseEdition).execute();
        break;
      case 'databaseTypes':
        data = await db.select().from(intMultiTenant).execute();
        break;
      case 'databaseVersions':
        data = await db.select().from(intDatabaseVersions).execute();
        break;
      case 'primaryUses':
        data = await db.select().from(intPrimaryUse).execute();
        break;
      case 'virtualizationTypes':
        data = await db.select().from(intVirtualizationTypes).execute();
        break;
      case 'coreFactors':
        // Get the data from the int_core_factor table
        const rawCoreFactorData = await db.select().from(intCoreFactor).execute();
        
        // Transform the data from snake_case to camelCase if needed
        data = rawCoreFactorData.map(item => {
          return {
            cpuModel: item.cpuModel || (item as any).cpu_model,
            coreFactor: item.coreFactor || (item as any).core_factor
          };
        });
        break;
      default:
        logger.warn(`Unknown table name: ${tableName}`);
        return res.status(404).json({ error: 'Reference table not found' });
    }

    res.json(data);
  } catch (error) {
    logger.error({ error, tableName }, `Error fetching reference table ${tableName}`);
    next(error);
  }
});

// Add a value to a reference table (Solo administradores)
router.post('/:tableName', isAdmin, async (req, res, next) => {
  try {
    const { tableName } = req.params;
    const { value, secondaryValue } = req.body;
    
    if (!value) {
      return res.status(400).json({ error: 'Value is required' });
    }
    
    // Handle each reference table based on its name
    switch (tableName) {
      case 'environmentTypes':
        await db.insert(intEnvironmentType).values({ envType: value }).execute();
        break;
      case 'databaseEditions':
        await db.insert(intDatabaseEdition).values({ databaseEdition: value }).execute();
        break;
      case 'databaseTypes':
        await db.insert(intMultiTenant).values({ tenantType: value }).execute();
        break;
      case 'databaseVersions':
        await db.insert(intDatabaseVersions).values({ databaseVersion: value }).execute();
        break;
      case 'primaryUses':
        await db.insert(intPrimaryUse).values({ primaryUse: value }).execute();
        break;
      case 'virtualizationTypes':
        await db.insert(intVirtualizationTypes).values({ virtType: value }).execute();
        break;
      case 'coreFactors':
        // Core factors require a secondary value (coreFactor)
        if (secondaryValue === undefined) {
          return res.status(400).json({ error: 'Core factor value is required' });
        }
        await db.insert(intCoreFactor).values({ 
          cpuModel: value, 
          coreFactor: parseFloat(secondaryValue) 
        }).execute();
        break;
      default:
        return res.status(400).json({ error: `Unknown reference table: ${tableName}` });
    }
    
    res.status(201).json({ message: 'Value added successfully' });
  } catch (error) {
    logger.error({ error, tableName: req.params.tableName }, `Error adding reference data to ${req.params.tableName}`);
    next(error);
  }
});

// Update a value in a reference table (Solo administradores)
router.put('/:tableName/:originalValue', isAdmin, async (req, res, next) => {
  try {
    const { tableName, originalValue } = req.params;
    const { value, secondaryValue } = req.body;
    
    if (!value) {
      return res.status(400).json({ error: 'New value is required' });
    }
    
    // Handle each reference table based on its name
    switch (tableName) {
      case 'environmentTypes':
        await db.update(intEnvironmentType)
          .set({ envType: value })
          .where(eq(intEnvironmentType.envType, originalValue))
          .execute();
        break;
      case 'databaseEditions':
        await db.update(intDatabaseEdition)
          .set({ databaseEdition: value })
          .where(eq(intDatabaseEdition.databaseEdition, originalValue))
          .execute();
        break;
      case 'databaseTypes':
        await db.update(intMultiTenant)
          .set({ tenantType: value })
          .where(eq(intMultiTenant.tenantType, originalValue))
          .execute();
        break;
      case 'databaseVersions':
        await db.update(intDatabaseVersions)
          .set({ databaseVersion: value })
          .where(eq(intDatabaseVersions.databaseVersion, originalValue))
          .execute();
        break;
      case 'primaryUses':
        await db.update(intPrimaryUse)
          .set({ primaryUse: value })
          .where(eq(intPrimaryUse.primaryUse, originalValue))
          .execute();
        break;
      case 'virtualizationTypes':
        await db.update(intVirtualizationTypes)
          .set({ virtType: value })
          .where(eq(intVirtualizationTypes.virtType, originalValue))
          .execute();
        break;
      case 'coreFactors':
        // For core factors, we update both the CPU model and core factor
        if (secondaryValue === undefined) {
          return res.status(400).json({ error: 'Core factor value is required' });
        }
        await db.update(intCoreFactor)
          .set({ 
            cpuModel: value, 
            coreFactor: parseFloat(secondaryValue) 
          })
          .where(eq(intCoreFactor.cpuModel, originalValue))
          .execute();
        break;
      default:
        return res.status(400).json({ error: `Unknown reference table: ${tableName}` });
    }
    
    res.json({ message: 'Value updated successfully' });
  } catch (error) {
    logger.error({ error, tableName: req.params.tableName }, `Error updating reference data in ${req.params.tableName}`);
    next(error);
  }
});

// Delete a value from a reference table (Solo administradores)
router.delete('/:tableName/:value', isAdmin, async (req, res, next) => {
  try {
    const { tableName, value } = req.params;
    
    // Handle each reference table based on its name
    switch (tableName) {
      case 'environmentTypes':
        await db.delete(intEnvironmentType)
          .where(eq(intEnvironmentType.envType, value))
          .execute();
        break;
      case 'databaseEditions':
        await db.delete(intDatabaseEdition)
          .where(eq(intDatabaseEdition.databaseEdition, value))
          .execute();
        break;
      case 'databaseTypes':
        await db.delete(intMultiTenant)
          .where(eq(intMultiTenant.tenantType, value))
          .execute();
        break;
      case 'databaseVersions':
        await db.delete(intDatabaseVersions)
          .where(eq(intDatabaseVersions.databaseVersion, value))
          .execute();
        break;
      case 'primaryUses':
        await db.delete(intPrimaryUse)
          .where(eq(intPrimaryUse.primaryUse, value))
          .execute();
        break;
      case 'virtualizationTypes':
        await db.delete(intVirtualizationTypes)
          .where(eq(intVirtualizationTypes.virtType, value))
          .execute();
        break;
      case 'coreFactors':
        await db.delete(intCoreFactor)
          .where(eq(intCoreFactor.cpuModel, value))
          .execute();
        break;
      default:
        return res.status(400).json({ error: `Unknown reference table: ${tableName}` });
    }
    
    res.json({ message: 'Value deleted successfully' });
  } catch (error) {
    logger.error({ error, tableName: req.params.tableName }, `Error deleting reference data from ${req.params.tableName}`);
    next(error);
  }
});

export default router;

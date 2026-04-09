import { Router } from 'express';
import db from '../database';
import { 
  customers, licenses, environments, hosts, instances, 
  pdbs, featureStats, coreAssignments, coreLicenseMappings,
  intDatabaseEdition, intEnvironmentType, 
  intMultiTenant, intCoreFactor, intDatabaseVersions,
  intPrimaryUse, intVirtualizationTypes, intLicenseProducts
} from '../../shared/schema';
import { eq, sql } from 'drizzle-orm';
import logger from '../utils/logger';

const router = Router();

/**
 * IMPORTANTE: Las rutas aquí NO deben incluir el prefijo '/api' ni '/maintenance' ya 
 * que eso se agrega cuando se monta el router en index.ts.
 * El middleware isAdmin se aplica en drizzle-routes.ts al montar este router.
 */

// Get all table names for maintenance purposes
router.get('/tables', async (req, res) => {
  try {
    // Define metadata tables
    const metadataTables = [
      { 
        id: 'environmentTypes',
        name: 'Environment Types',
        tableName: 'intEnvironmentType',
        valueColumn: 'envType',
        hasMultipleColumns: false
      },
      {
        id: 'databaseEditions',
        name: 'Database Editions',
        tableName: 'intDatabaseEdition',
        valueColumn: 'databaseEdition',
        hasMultipleColumns: false
      },
      {
        id: 'databaseTypes',
        name: 'Database Types',
        tableName: 'intMultiTenant',
        valueColumn: 'tenantType',
        hasMultipleColumns: false
      },
      {
        id: 'databaseVersions',
        name: 'Database Versions',
        tableName: 'intDatabaseVersions',
        valueColumn: 'databaseVersion',
        hasMultipleColumns: false
      },
      {
        id: 'primaryUses',
        name: 'Primary Uses',
        tableName: 'intPrimaryUse',
        valueColumn: 'primaryUse',
        hasMultipleColumns: false
      },
      {
        id: 'virtualizationTypes',
        name: 'Virtualization Types',
        tableName: 'intVirtualizationTypes',
        valueColumn: 'virtType',
        hasMultipleColumns: false
      },
      {
        id: 'coreFactors',
        name: 'Core Factors',
        tableName: 'intCoreFactor',
        valueColumn: 'cpuModel',
        secondaryColumn: 'coreFactor',
        hasMultipleColumns: true
      },
      {
        id: 'licenseProducts',
        name: 'License Products',
        tableName: 'intLicenseProducts',
        valueColumn: 'product',
        secondaryColumn: 'onlyEnterprise',
        hasMultipleColumns: true
      }
    ];
    
    res.json(metadataTables);
  } catch (error) {
    logger.error('Error fetching maintenance tables:', error);
    res.status(500).json({ error: 'Failed to fetch maintenance tables' });
  }
});

// Get values for a specific table
router.get('/tables/:tableId', async (req, res) => {
  try {
    const { tableId } = req.params;
    let data = [];
    
    logger.debug(`Getting table data for: ${tableId}`);
    
    switch (tableId) {
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
        data = await db.select().from(intCoreFactor).execute();
        break;
      case 'licenseProducts':
        data = await db.select().from(intLicenseProducts).execute();
        break;
      case 'customers':
        data = await db.select().from(customers).execute();
        break;
      case 'licenses':
        data = await db.select().from(licenses).execute();
        break;
      case 'environments':
        data = await db.select().from(environments).execute();
        break;
      case 'hosts':
        data = await db.select().from(hosts).execute();
        break;
      case 'instances':
        data = await db.select().from(instances).execute();
        break;
      case 'pdbs':
        data = await db.select().from(pdbs).execute();
        break;
      case 'featureStats':
        data = await db.select().from(featureStats).execute();
        break;
      case 'coreAssignments':
        data = await db.select().from(coreAssignments).execute();
        break;
      case 'coreLicenseMappings':
        data = await db.select({
          id: coreLicenseMappings.coreAssignmentId, // Use combined ID as primary key
          coreAssignmentId: coreLicenseMappings.coreAssignmentId,
          licenseId: coreLicenseMappings.licenseId,
          assignmentDate: coreLicenseMappings.assignmentDate,
          notes: coreLicenseMappings.notes
        }).from(coreLicenseMappings).execute();
        break;      case 'licenseHostMappings':
        // This table no longer exists, return empty array for backward compatibility
        logger.warn('Accessing deprecated licenseHostMappings table');
        data = [];
        break;
      default:
        return res.status(404).json({ error: 'Table not found' });
    }
    
    logger.debug(`Retrieved ${data.length} rows for table: ${tableId}`);
    res.json(data);
  } catch (error) {
    logger.error(`Error fetching data for table ${req.params.tableId}:`, error);
    res.status(500).json({ error: `Failed to fetch table data: ${(error as Error).message}` });
  }
});

// Añadir un nuevo valor a una tabla de referencia
router.post('/tables/:tableId', async (req, res) => {
  try {
    const { tableId } = req.params;
    const { value, secondaryValue } = req.body;
    
    logger.debug(`Adding new value to table ${tableId}: ${value}, ${secondaryValue}`);
    
    if (!value) {
      return res.status(400).json({ error: 'Value is required' });
    }
    
    // Handle each reference table based on its name
    switch (tableId) {
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
          coreFactor: parseFloat(secondaryValue as string) 
        }).execute();
        break;
      case 'licenseProducts':
        // License products might have a secondary value (onlyEnterprise)
        await db.insert(intLicenseProducts).values({
          product: value,
          onlyEnterprise: secondaryValue === true || secondaryValue === 'true',
          oracleFeatureNames: req.body.oracleFeatureNames || null
        }).execute();
        break;
      default:
        return res.status(400).json({ error: `Unknown reference table: ${tableId}` });
    }
    
    logger.debug(`Value added successfully to ${tableId}`);
    res.status(201).json({ success: true, message: 'Value added successfully' });
  } catch (error) {
    logger.error(`Error adding reference data to ${req.params.tableId}:`, error);
    res.status(500).json({ error: `Failed to add reference data: ${(error as Error).message}` });
  }
});

// Actualizar un valor existente en una tabla de referencia
router.put('/tables/:tableId/:oldValue', async (req, res) => {
  try {
    const { tableId, oldValue } = req.params;
    const { value, secondaryValue } = req.body;
    
    logger.debug(`Updating value in table ${tableId}: ${oldValue} -> ${value}, ${secondaryValue}`);
    
    if (!value) {
      return res.status(400).json({ error: 'New value is required' });
    }
    
    // Handle each reference table based on its name
    switch (tableId) {
      case 'environmentTypes':
        await db.update(intEnvironmentType)
          .set({ envType: value })
          .where(eq(intEnvironmentType.envType, oldValue))
          .execute();
        break;
      case 'databaseEditions':
        await db.update(intDatabaseEdition)
          .set({ databaseEdition: value })
          .where(eq(intDatabaseEdition.databaseEdition, oldValue))
          .execute();
        break;
      case 'databaseTypes':
        await db.update(intMultiTenant)
          .set({ tenantType: value })
          .where(eq(intMultiTenant.tenantType, oldValue))
          .execute();
        break;
      case 'databaseVersions':
        await db.update(intDatabaseVersions)
          .set({ databaseVersion: value })
          .where(eq(intDatabaseVersions.databaseVersion, oldValue))
          .execute();
        break;
      case 'primaryUses':
        await db.update(intPrimaryUse)
          .set({ primaryUse: value })
          .where(eq(intPrimaryUse.primaryUse, oldValue))
          .execute();
        break;
      case 'virtualizationTypes':
        await db.update(intVirtualizationTypes)
          .set({ virtType: value })
          .where(eq(intVirtualizationTypes.virtType, oldValue))
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
            coreFactor: parseFloat(secondaryValue as string) 
          })
          .where(eq(intCoreFactor.cpuModel, oldValue))
          .execute();
        break;
      case 'licenseProducts':
        await db.update(intLicenseProducts)
          .set({ 
            product: value,
            onlyEnterprise: secondaryValue === true || secondaryValue === 'true',
            oracleFeatureNames: req.body.oracleFeatureNames !== undefined ? req.body.oracleFeatureNames : undefined
          })
          .where(eq(intLicenseProducts.product, oldValue))
          .execute();
        break;
      default:
        return res.status(400).json({ error: `Unknown reference table: ${tableId}` });
    }
    
    logger.debug(`Value updated successfully in ${tableId}`);
    res.json({ success: true, message: 'Value updated successfully' });
  } catch (error) {
    logger.error(`Error updating reference data in ${req.params.tableId}:`, error);
    res.status(500).json({ error: `Failed to update reference data: ${(error as Error).message}` });
  }
});

// Eliminar un valor de una tabla de referencia
router.delete('/tables/:tableId/:value', async (req, res) => {
  try {
    const { tableId, value } = req.params;
    
    logger.debug(`Deleting value '${value}' from table ${tableId}`);
    
    // Handle each reference table based on its name
    switch (tableId) {
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
      case 'licenseProducts':
        await db.delete(intLicenseProducts)
          .where(eq(intLicenseProducts.product, value))
          .execute();
        break;
      default:
        return res.status(400).json({ error: `Unknown reference table: ${tableId}` });
    }
    
    logger.debug(`Value deleted successfully from ${tableId}`);
    res.json({ success: true, message: 'Value deleted successfully' });
  } catch (error) {
    logger.error(`Error deleting reference data from ${req.params.tableId}:`, error);
    res.status(500).json({ error: `Failed to delete reference data: ${(error as Error).message}` });
  }
});

// Endpoint para borrar todos los datos (operación crítica que requiere confirmación)
router.post('/erase-all-data', async (req, res) => {
  try {
    const { confirmationCode } = req.body;
    
    // Verificar la confirmación para evitar borrados accidentales
    if (confirmationCode !== 'ERASE_ALL_DATA') {
      return res.status(400).json({ 
        error: 'Invalid confirmation code. Please provide the correct confirmation code to proceed with this critical operation.' 
      });
    }
    
    logger.debug('Erasing all data from the database - This operation was requested by an administrator');
    
    await db.transaction(async (tx) => {
      // Eliminar tablas de datos en orden correcto para respetar las relaciones
      
      // 1. Eliminar feature stats
      await tx.delete(featureStats).execute();
      
      // 2. Eliminar pdbs
      await tx.delete(pdbs).execute();
      
      // 4. Eliminar core-license mappings
      await tx.delete(coreLicenseMappings).execute();
      
      // 5. Eliminar license-host mappings 
      // licenseHostMappings table no longer exists
      // await tx.delete(licenseHostMappings).execute();
      
      // 6. Eliminar core assignments
      await tx.delete(coreAssignments).execute();
      
      // 7. Eliminar instances
      await tx.delete(instances).execute();
      
      // 8. Eliminar environments
      await tx.delete(environments).execute();
      
      // 9. Eliminar hosts
      await tx.delete(hosts).execute();
      
      // 10. Eliminar licenses
      await tx.delete(licenses).execute();
      
      // 11. Finalmente eliminar customers
      // Nota: Mantenemos al usuario administrador
      await tx.delete(customers)
        .where(sql`role != 'admin'`)
        .execute();
      
      // Nota: No eliminamos las tablas de referencia/metadatos (intXXX)
    });
    
    logger.debug('All data has been erased successfully');
    res.json({ success: true, message: 'All data has been erased successfully' });
  } catch (error) {
    logger.error('Error erasing all data:', error);
    res.status(500).json({ error: 'Failed to erase data', details: (error as Error).message });
  }
});

export default router;
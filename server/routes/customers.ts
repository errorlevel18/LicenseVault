import { Router } from 'express';
import { z } from 'zod';
import db from '../database';
import { customers, hosts, environments, licenses } from '../../shared/schema';
import { safeOperation, withTransaction } from '../utils/error-handler';
import logger from '../utils/logger';
import { validateRequest } from '../middlewares/validationMiddleware';
import { isAdmin } from '../middlewares/authMiddleware';
import { eq, or, like, and, SQL } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { hashPassword } from '../routes/auth';

const router = Router();

// Strip sensitive fields from customer data before sending to client
function sanitizeCustomer(customer: any) {
  const { password, ...safe } = customer;
  return safe;
}

// Esquema para validar la creación de clientes
const createCustomerSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'El nombre es requerido'),
    description: z.string().optional(),
    email: z.union([
      z.string().email('Email inválido'),
      z.string().length(0),
      z.null(),
      z.undefined()
    ]).optional(),
    password: z.string().optional(),
    role: z.enum(['admin', 'customer']).optional().default('customer'),
    active: z.boolean().optional().default(true)
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

// Esquema para validar la actualización de clientes
const updateCustomerSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'El nombre es requerido'),
    description: z.string().optional(),
    email: z.union([
      z.string().email('Email inválido'),
      z.string().length(0),
      z.null(),
      z.undefined()
    ]).optional(),
    password: z.string().optional(),
    active: z.boolean().optional()
  }),
  params: z.object({
    id: z.string().min(1, 'El ID del cliente es requerido')
  }),
  query: z.object({}).optional()
});

// Get all customers with filters
router.get('/', async (req, res, next) => {
  try {
    const { search, status } = req.query;
    
    logger.debug({ user: req.user, path: req.path, query: req.query }, 'Get customers with filters request received');
    
    // IDOR protection: non-admin users can only see their own customer record
    const user = req.user as any;
    if (user?.role !== 'admin') {
      const ownCustomer = await db
        .select()
        .from(customers)
        .where(eq(customers.id, user.id))
        .execute();
      return res.json(ownCustomer.map(sanitizeCustomer));
    }
    
    let customersData;
    
    // Aplicar filtros si se proporcionan
    if (search || status) {
      const conditions: SQL[] = [];      if (search) {
        const searchTerm = `%${search}%`;
        // Solo buscar por nombre, para evitar problemas con emails nulos
        // Ya que SQLite no maneja bien el operador LIKE con valores NULL
        conditions.push(like(customers.name, searchTerm));
      }
      
      if (status === 'active') {
        conditions.push(eq(customers.active, true));
      } else if (status === 'inactive') {
        conditions.push(eq(customers.active, false));
      }
      
      // Ejecutar la consulta con filtros
      if (conditions.length > 0) {
        customersData = await db
          .select()
          .from(customers)
          .where(and(...conditions))
          .execute();
      }
    }
    
    // Si no hay filtros o algún error con los filtros, obtener todos los clientes
    if (!customersData) {
      customersData = await db.select().from(customers).execute();
    }
    
    logger.info(`Get filtered customers successful, returned ${customersData.length} results`);
    res.json(customersData.map(sanitizeCustomer));
  } catch (error) {
    logger.error({ error }, 'Error fetching customers with filters');
    next(error);
  }
});

// Get customer by ID
router.get('/:id', async (req, res, next) => {
  const { id } = req.params;
  
  // IDOR protection: non-admin users can only access their own customer data
  const user = req.user as any;
  if (user?.role !== 'admin' && id !== user.id) {
    return res.status(403).json({ error: 'Unauthorized access' });
  }
  
  logger.debug({ id, user: req.user, path: req.path }, 'Get customer by ID request received');
  
  try {
    const customer = await db
      .select()
      .from(customers)
      .where(eq(customers.id, id))
      .execute();
      
    if (!customer.length) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    logger.info(`Customer ${id} get request successful`);
    res.json(sanitizeCustomer(customer[0]));
  } catch (error) {
    logger.error({ error, customerId: id }, 'Error fetching customer');
    next(error);
  }
});

// Endpoint para crear un nuevo cliente
router.post('/', validateRequest(createCustomerSchema), isAdmin, async (req, res, next) => {
  try {
    const { password, ...customerData } = req.body;
    
    // Normalize empty email to null (UNIQUE constraint allows multiple NULLs)
    if (!customerData.email || customerData.email.trim() === '') {
      customerData.email = null;
    }
    
    logger.debug({ user: req.user, path: req.path }, 'Create customer request received');
    
    // Generar un ID único para el cliente
    const customerId = randomUUID();
    
    // Hashear la contraseña si se proporciona una
    let hashedPassword = '';
    if (password) {
      hashedPassword = await hashPassword(password);
    }
    
    // Crear el cliente con contraseña hasheada
    const newCustomer = await withTransaction(async (tx) => {
      const result = await tx
        .insert(customers)
        .values({
          id: customerId,
          ...customerData,
          password: hashedPassword,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        .returning()
        .execute();
        
      return result[0];
    });
    
    logger.info(`Customer ${customerId} created successfully`);
    res.status(201).json(sanitizeCustomer(newCustomer));
  } catch (error) {
    logger.error({ error }, 'Error creating customer');
    next(error);
  }
});

// Endpoint para actualizar un cliente existente
router.put('/:id', validateRequest(updateCustomerSchema), isAdmin, async (req, res, next) => {
  const { id } = req.params;
  const { password, ...updateData } = req.body;
  
  // Normalize empty email to null (UNIQUE constraint allows multiple NULLs)
  if (!updateData.email || updateData.email.trim() === '') {
    updateData.email = null;
  }
  
  logger.debug({ id, user: req.user, path: req.path }, 'Update customer request received');
  
  try {
    // Verificar que el cliente existe
    const customer = await db
      .select()
      .from(customers)
      .where(eq(customers.id, id))
      .execute();
      
    if (!customer.length) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    // Si se proporciona una nueva contraseña, hashearla
    if (password) {
      updateData.password = await hashPassword(password);
    }
    
    // Actualizar el cliente
    const updatedCustomer = await withTransaction(async (tx) => {
      const result = await tx
        .update(customers)
        .set({
          ...updateData,
          updatedAt: new Date().toISOString()
        })
        .where(eq(customers.id, id))
        .returning()
        .execute();
        
      return result[0];
    });
    
    logger.info(`Customer ${id} updated successfully`);
    res.json(sanitizeCustomer(updatedCustomer));
  } catch (error) {
    logger.error({ error, customerId: id }, 'Error updating customer');
    next(error);
  }
});

// Schema para validar parámetros en la ruta de eliminación
const deleteCustomerSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'ID del cliente es requerido')
  }),
  body: z.object({}).optional(),
  query: z.object({}).optional()
});

/**
 * IMPORTANTE: Las rutas aquí NO deben incluir el prefijo '/api' ya que eso se agrega
 * cuando se monta el router en index.ts
 * 
 * Endpoint para eliminar un cliente y todas sus entidades asociadas
 * Mueve la lógica de eliminación en cascada desde el cliente al servidor
 */
router.delete('/:id', validateRequest(deleteCustomerSchema), isAdmin, async (req, res, next) => {
  const { id } = req.params;
  
  logger.debug({ id, user: req.user, path: req.path }, 'Delete customer request received');
  
  try {
    // Usar withTransaction para garantizar la consistencia de los datos y manejo de errores
    await withTransaction(async (tx) => {
      // Verificar que el cliente existe
      const customer = await tx
        .select()
        .from(customers)
        .where(eq(customers.id, id))
        .execute();
        
      if (!customer.length) {
        const error: any = new Error('Customer not found');
        error.status = 404;
        throw error;
      }
      
      // Eliminar todas las entidades relacionadas en orden para mantener integridad referencial
      
      // 1. Primero eliminar hosts
      await tx.delete(hosts).where(eq(hosts.customerId, id)).execute();
      
      // 2. Eliminar environments
      await tx.delete(environments).where(eq(environments.customerId, id)).execute();
      
      // 3. Eliminar licenses
      await tx.delete(licenses).where(eq(licenses.customerId, id)).execute();
      
      // 4. Finalmente eliminar el cliente
      await tx.delete(customers).where(eq(customers.id, id)).execute();
    });
    
    logger.info(`Customer ${id} deleted successfully with all related entities`);
    res.json({ success: true, message: 'Customer and all associated entities deleted successfully' });
  } catch (error) {
    logger.error({ error, customerId: id }, 'Error deleting customer');
    next(error);
  }
});

export default router;
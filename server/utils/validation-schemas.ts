import { z } from 'zod';

// Esquema para la validación del cliente (customer)
export const customerSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'El nombre es requerido'),
    description: z.string().optional(),
    contact: z.string().optional(),
    email: z.string().email('Email inválido').optional(),
    phone: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    role: z.enum(['admin', 'customer']).optional(),
    active: z.boolean().optional(),
    id: z.string().optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

// Esquema para la validación de licencias
export const licenseSchema = z.object({
  body: z.object({
    id: z.string().optional(),
    product: z.string().min(1, 'El producto es requerido'),
    edition: z.string().min(1, 'La edición es requerida'),
    licenseType: z.string().optional(),
    metric: z.string().min(1, 'La métrica es requerida'),
    quantity: z.number().nonnegative('La cantidad debe ser un número no negativo'),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    status: z.string().optional(),
    csi: z.string().optional(),
    comments: z.string().optional(),
    quantityUsed: z.number().nonnegative().optional(),
    quantityFree: z.number().nonnegative().optional(),
    customerId: z.string().min(1, 'El ID del cliente es requerido'),
    hostIds: z.array(z.string()).optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

// Esquema para la validación de entorno (environment)
export const environmentSchema = z.object({
  body: z.object({
    id: z.string().optional(),
    name: z.string().min(1, 'El nombre es requerido'),
    type: z.string().optional(),
    primaryUse: z.string().optional(),
    edition: z.string().optional(),
    version: z.string().optional(),
    dbType: z.string().optional(),
    isDataGuard: z.boolean().optional(),
    complianceStatus: z.string().optional(),
    licenseRequired: z.number().optional(),
    licenseAssigned: z.number().optional(),
    requiredCores: z.number().optional(),
    assignedCores: z.number().optional(),
    requiredNups: z.number().optional(),
    assignedNups: z.number().optional(),
    customerId: z.string().min(1, 'El ID del cliente es requerido'),
    instances: z.array(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1, 'El nombre de la instancia es requerido'),
        hostId: z.string().optional(),
        environmentId: z.string().optional(),
        isPrimary: z.boolean().optional(),
        deleted: z.boolean().optional()
      })
    ).optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

// Esquema para la validación de host
export const hostSchema = z.object({
  body: z.object({
    id: z.string().optional(),
    name: z.string().min(1, 'El nombre es requerido'),
    cpuModel: z.string().optional(),
    serverType: z.string().optional(),
    virtualizationType: z.string().optional(),
    hasHardPartitioning: z.boolean().optional(),
    sockets: z.number().nonnegative().optional(),
    cores: z.number().nonnegative().optional(),
    threadsPerCore: z.number().positive().optional(),
    coreFactor: z.number().positive().optional(),
    physicalHostId: z.string().optional(),
    customerId: z.string().min(1, 'El ID del cliente es requerido'),
    licenseIds: z.array(z.string()).optional(),
    coreArray: z.array(
      z.object({
        coreId: z.string(),
        physicalCoreId: z.string().optional(),
        licenses: z.array(z.string()).optional()
      })
    ).optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

// Esquema para la validación de inicios de sesión
export const loginSchema = z.object({
  body: z.object({
    username: z.string().min(1, 'El nombre de usuario es requerido'),
    password: z.string().optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

// Esquema para la validación de ejecuciones de compliance
export const complianceRunSchema = z.object({
  body: z.object({
    customerId: z.string().optional(),
    triggeredBy: z.string().optional(),
    notes: z.string().optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

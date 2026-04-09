// License Types
export type LicenseType = 'Processor' | 'Named User Plus' | 'Application User';
export type LicenseEdition = 'Enterprise' | 'Standard' | 'Standard One' | 'Standard 2';
export type LicenseStatus = 'Active' | 'Expired' | 'Pending';

// Environment Types - Ahora dinámicos, cargados desde la base de datos
// Tipos para comprobación en tiempo de compilación
export type EnvironmentType = string;
export type DatabaseEdition = string;
export type FeatureStatus = 'Licensed' | 'Not Licensed' | 'No Disponible'; // Este se mantiene por ser de estado
export type DatabaseType = string;

// PDB related types
export interface PDB {
  id: string;
  name: string;
  environmentId: string;
  hostId: string;
  status: string;
  created: string;
  size?: number;
}

// Added Instance interface for environment instances
export interface Instance {
  id: string;
  name: string;
  hostId: string;
  isPrimary?: boolean;
  status?: string; // Match the status field in the server-side schema
  environmentId?: string;
  sessions?: number; // Adding sessions property used in EnvironmentForm
}

// Feature Stat interface for environment features
export interface FeatureStat {
  name: string;
  currentlyUsed: boolean;
  status: FeatureStatus;
}

// License Interface
export interface License {
  id: string;
  name: string;
  licenseType: LicenseType;
  edition: LicenseEdition;
  quantity: number;
  quantityUsed?: number;
  quantityFree?: number;
  startDate?: string;
  endDate?: string;
  status?: LicenseStatus;
  details?: string;
  csi?: string;
  customerId?: string;
  licensable?: boolean;
  
  // Added missing properties used in complianceService
  hostIds?: string[];
  product?: string;
  metric?: string;
}

// Core to License Assignment Interface
export interface CoreLicenseAssignment {
  coreId: number;
  licenses: string[];
  physicalCoreId?: number; // Añadido para soportar mapeo de cores
}

// Core Assignment Interface
export interface CoreAssignment {
  id: number;
  hostId: string;
  coreId: number;
  physicalCoreId?: number;
  licenseId?: string;
}

// Host Interface
export interface Host {
  id: string;
  name: string;
  serverType: 'Physical' | 'Virtual' | 'Oracle Cloud';
  virtualizationType?: string;
  cpuModel?: string;
  coreCount: number;
  threadCount: number;
  environmentId?: string;
  clusterId?: string;
  physicalHostId?: string;
  coreAssignments?: CoreAssignment[];
  coreArray?: CoreLicenseAssignment[]; // Added to match implementation in code
  customerId?: string;
  coreFactor?: number;
  sockets?: number;
  cores?: number;
  hasHardPartitioning?: boolean;
  threadsPerCore?: number;
  coreMapping?: Record<number, number>;
  updatedAt?: string;
}

// Environment Interface
export interface Environment {
  id: string;
  name: string;
  description?: string;
  version?: string;
  edition?: string;
  type?: string;
  hosts?: string[];
  licensable?: boolean;
  primaryUse?: string;
  customerId?: string;
  dbType?: string;
  options?: string[];
  managementPacks?: string[];
  expiredAt?: string;
  
  // Added missing properties used in complianceService
  instances: Instance[];
  pdbs?: PDB[];  // Adding PDB support for CDB environments
  featureStats: FeatureStat[];
  isDataGuard?: boolean;
  licenseRequired?: number;
  licenseAssigned?: number;
  requiredCores?: number;
  assignedCores?: number;
  requiredNUPs?: number;
  assignedNUPs?: number;
}

// Alert Interface
export interface Alert {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  entityId?: string;
  entityType?: 'license' | 'host' | 'environment';
  timestamp: string;
  resolved?: boolean;
  customerId?: string;
  
  // Added missing properties used in complianceService
  type?: 'error' | 'warning' | 'info';
  environmentId?: string;
  licenseId?: string;
}

// Customer Interface
export interface Customer {
  id: string;
  name: string;
  description?: string;
  email?: string;
  phone?: string;
  username?: string;
  password?: string;
  active: boolean;
  role?: string;
}

// App Storage Interface
export interface AppStorage {
  t_licenses: License[];
  t_hosts: Host[];
  t_environments: Environment[];
  t_customers: Customer[];
}

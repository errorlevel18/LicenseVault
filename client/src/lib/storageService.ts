import { v4 as uuidv4 } from 'uuid';
import { AppStorage, License, Host, Environment, Alert, CoreLicenseAssignment, Customer } from './types';
import apiClient from './apiClient';
import { authService } from './authService';
import axios, { AxiosError } from 'axios';  // Import axios and AxiosError type
import logger from './logger';  // Import logger service


// Constants
const STORAGE_KEY = 'oracle_license_manager';
const SELECTED_CUSTOMER_KEY = 'oracle_license_manager_selected_customer';
const CUSTOMER_SELECTION_EVENT = 'customer_selection_event';
// API URL is now handled by apiClient with baseURL

/**
 * Storage service that manages all storage operations for the application
 * Communicates with the server's SQLite database for persistence
 */
class StorageService {
  // Memory cache for improved performance
  private cache: AppStorage = {
    t_licenses: [],
    t_hosts: [],
    t_environments: [],
    t_customers: []
  };

  constructor() {
    // No inicializar automáticamente los datos
    // Ahora se inicializará solo después del login exitoso
  }

  /**
   * Initialize data from server - now called explicitly after login
   */
  async initialize(): Promise<void> {
    if (authService.isAuthenticated()) {
      try {
        await this.loadFromServer();
      } catch (error) {
        logger.error('Failed to initialize data from server:', error);
      }
    } else {
      logger.info('StorageService: Not initializing - user not authenticated');
    }
  }

  /**
   * Load data from server
   */
  private async loadFromServer(): Promise<void> {
    try {
      // Verificar el rol del usuario
      const user = authService.getCurrentUser();
      const isAdmin = authService.isAdmin();
      const userId = user?.id;
      
      // Determinar si necesitamos filtrar por cliente específico
      const selectedCustomerId = this.getSelectedCustomerId();
      
      // Realizar peticiones según el rol del usuario
      if (isAdmin) {
        // Los administradores pueden ver todos los datos
        const [
          customersResponse,
          licensesResponse,
          hostsResponse,
          environmentsResponse
        ] = await Promise.all([
          apiClient.get('/customers'),
          apiClient.get('/licenses'),
          apiClient.get('/hosts'),
          apiClient.get('/environments'),
        ]);
        
        // Ensure each data array is actually an array
        const customers = Array.isArray(customersResponse.data) ? customersResponse.data : [];
        const licenses = Array.isArray(licensesResponse.data) ? licensesResponse.data : [];
        const hosts = Array.isArray(hostsResponse.data) ? hostsResponse.data : [];
        const environments = Array.isArray(environmentsResponse.data) ? environmentsResponse.data : [];
        
        // Update cache
        this.cache = {
          t_customers: customers,
          t_licenses: licenses,
          t_hosts: hosts,
          t_environments: environments
        };
      } else {
        // Los usuarios normales solo pueden ver sus propios datos
        if (!selectedCustomerId) {
          console.warn('Usuario no administrador sin cliente seleccionado');
          // Inicializar con arrays vacíos para evitar errores
          this.cache = {
            t_customers: [],
            t_licenses: [],
            t_hosts: [],
            t_environments: []
          };
          return;
        }
        
        const [
          customerResponse,
          licensesResponse,
          hostsResponse,
          environmentsResponse
        ] = await Promise.all([
          apiClient.get(`/customers/${selectedCustomerId}`),
          apiClient.get(`/licenses?customerId=${selectedCustomerId}`),
          apiClient.get(`/hosts?customerId=${selectedCustomerId}`),
          apiClient.get(`/environments?customerId=${selectedCustomerId}`),
        ]);
        
        // Para usuarios no admin, solo incluimos su propio cliente en el array
        const customer = customerResponse.data;
        const customers = customer ? [customer] : [];
        
        // Ensure each data array is actually an array
        const licenses = Array.isArray(licensesResponse.data) ? licensesResponse.data : [];
        const hosts = Array.isArray(hostsResponse.data) ? hostsResponse.data : [];
        const environments = Array.isArray(environmentsResponse.data) ? environmentsResponse.data : [];
        
        // Update cache
        this.cache = {
          t_customers: customers,
          t_licenses: licenses,
          t_hosts: hosts,
          t_environments: environments
        };
      }
      
    } catch (error) {
      logger.error('Error loading data from server:', error);
      throw error;
    }
  }

  // DATA MANAGEMENT METHODS

  /**
   * Get all stored data
   */
  async getData(): Promise<AppStorage> {
    try {
      await this.loadFromServer();
      return this.cache;
    } catch (error) {
      logger.error('Error fetching data:', error);
      throw error;
    }
  }

  /**
   * Import external data
   */
  async importData(data: AppStorage): Promise<void> {
    try {
      await apiClient.post('/import', { data });
      await this.loadFromServer();
    } catch (error) {
      logger.error('Error importing data:', error);
      throw error;
    }
  }

  /**
   * Export all data
   */
  async exportData(): Promise<AppStorage> {
    return this.getData();
  }

  /**
   * Erase all data from the application
   */
  async eraseAllData(): Promise<void> {
    try {
      // Utilizar la nueva ruta de mantenimiento con código de confirmación
      await apiClient.post('/maintenance/erase-all-data', {
        confirmationCode: 'ERASE_ALL_DATA'
      });
      
      // Recargar los datos desde el servidor después de borrar todo
      await this.loadFromServer();
      
      // Limpiar el cliente seleccionado
      this.setSelectedCustomerId(null);
    } catch (error) {
      logger.error('Error erasing all data:', error);
      throw error;
    }
  }

  // LICENSE CRUD METHODS

  /**
   * Get all licenses
   */
  async getLicenses(): Promise<License[]> {
    // Verificar autenticación antes de hacer la solicitud
    if (!authService.isAuthenticated()) {
      console.warn('StorageService: Intentando acceder a datos de licencias sin autenticación');
      return [];
    }
    
    try {
      const customerId = this.getSelectedCustomerId();
      let url = `/licenses`;
      
      if (customerId) {
        url += `?customerId=${customerId}`;
      }
      
      const response = await apiClient.get(url);
      this.cache.t_licenses = response.data;
      return response.data;
    } catch (error) {
      logger.error('Error fetching licenses:', error);
      throw error;
    }
  }

  /**
   * Get all licenses for a specific customer
   * @param customerId The ID of the customer to get licenses for (optional - uses selected customer if not provided)
   * @returns Promise<License[]> The licenses for the customer
   */
  async getLicensesByCustomer(customerId?: string | null): Promise<License[]> {
    try {
      // If no customerId provided, use the selected customer ID
      const customerIdToUse = customerId || this.getSelectedCustomerId();
      
      // If still no customerId, return empty array
      if (!customerIdToUse) {
        console.warn('No customerId provided to getLicensesByCustomer and no customer selected');
        return [];
      }

      const response = await apiClient.get(`/licenses?customerId=${customerIdToUse}`);
      
      // Update cache with these licenses
      const existingLicenses = this.cache.t_licenses.filter(l => l.customerId !== customerIdToUse);
      this.cache.t_licenses = [...existingLicenses, ...response.data];
      
      return response.data;
    } catch (error) {
      logger.error(`Error fetching licenses for customer ${customerId}:`, error);
      throw error;
    }
  }

  /**
   * Get license by ID
   */
  async getLicense(id: string): Promise<License | undefined> {
    try {
      const response = await apiClient.get(`/licenses/${id}`);
      
      // Update cache
      const licenseIndex = this.cache.t_licenses.findIndex(l => l.id === id);
      if (licenseIndex !== -1) {
        this.cache.t_licenses[licenseIndex] = response.data;
      } else {
        this.cache.t_licenses.push(response.data);
      }
      
      return response.data;
    } catch (error) {
      logger.error(`Error fetching license ${id}:`, error);
      throw error;
    }
  }

  /**
   * Add a new license
   */
  async addLicense(license: Omit<License, 'id'>): Promise<License> {
    try {
      const response = await apiClient.post(`/licenses`, license);
      this.cache.t_licenses.push(response.data);
      return response.data;
    } catch (error) {
      logger.error('Error creating license:', error);
      throw error;
    }
  }

  /**
   * Update an existing license
   */
  async updateLicense(id: string, license: Partial<License>): Promise<License | undefined> {
    try {
      const response = await apiClient.put(`/licenses/${id}`, license);
      
      // Update cache
      const index = this.cache.t_licenses.findIndex(l => l.id === id);
      if (index !== -1) {
        this.cache.t_licenses[index] = response.data;
      }
      
      return response.data;
    } catch (error) {
      logger.error(`Error updating license ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete a license
   */
  async deleteLicense(id: string): Promise<boolean> {
    try {
      // Llamar al endpoint que maneja la eliminación y la limpieza de referencias
      await apiClient.delete(`/licenses/${id}`);
      
      // Actualizar caché local
      this.cache.t_licenses = this.cache.t_licenses.filter(license => license.id !== id);
      
      // Ya no necesitamos llamar a cleanLicenseReferences aquí porque el servidor lo maneja
      
      return true;
    } catch (error) {
      logger.error(`Error deleting license ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete all licenses for the current customer
   */
  async deleteAllLicenses(customerId: string): Promise<number> {
    const res = await apiClient.delete(`/licenses/all?customerId=${customerId}`);
    this.cache.t_licenses = [];
    return res.data.deleted || 0;
  }

  async clearLicenseAssignments(customerId?: string | null): Promise<string> {
    try {
      const customerIdToUse = customerId || this.getSelectedCustomerId();

      if (!customerIdToUse) {
        throw new Error('No hay cliente seleccionado para limpiar asignaciones');
      }

      const response = await apiClient.post('/licenses/clear-license-assignments', {
        customerId: customerIdToUse,
      });

      await this.loadFromServer();

      return response.data?.message || 'Todas las asignaciones de licencias han sido eliminadas';
    } catch (error) {
      logger.error('Error clearing license assignments:', error);
      throw error;
    }
  }

  // HOST CRUD METHODS

  /**
   * Get all hosts
   */
  async getHosts(): Promise<Host[]> {
    // Verificar autenticación antes de hacer la solicitud
    if (!authService.isAuthenticated()) {
      console.warn('StorageService: Intentando acceder a datos de hosts sin autenticación');
      return [];
    }
    
    try {
      const customerId = this.getSelectedCustomerId();
      let url = `/hosts`;
      
      if (customerId) {
        url += `?customerId=${customerId}`;
      }
      
      const response = await apiClient.get(url);
      this.cache.t_hosts = response.data;
      return response.data;
    } catch (error) {
      logger.error('Error fetching hosts:', error);
      throw error;
    }
  }

  /**
   * Get all hosts for a specific customer
   * @param customerId The ID of the customer to get hosts for
   * @returns Promise<Host[]> The hosts for the customer
   */
  async getHostsByCustomer(customerId?: string | null): Promise<Host[]> {
    try {
      // If no customerId provided, use the selected customer ID
      const customerIdToUse = customerId || this.getSelectedCustomerId();
      
      // If still no customerId, return empty array
      if (!customerIdToUse) {
        console.warn('No customerId provided to getHostsByCustomer and no customer selected');
        return [];
      }

      const response = await apiClient.get(`/hosts?customerId=${customerIdToUse}`);
      
      // Update cache with these hosts
      const existingHosts = this.cache.t_hosts.filter(h => h.customerId !== customerIdToUse);
      this.cache.t_hosts = [...existingHosts, ...response.data];
      
      return response.data;
    } catch (error) {
      logger.error(`Error fetching hosts for customer ${customerId}:`, error);
      throw error;
    }
  }

  /**
   * Get host by ID
   */
  async getHost(id: string): Promise<Host | undefined> {
    try {
      const response = await apiClient.get(`/hosts/${id}`);
      
      // Update cache
      const hostIndex = this.cache.t_hosts.findIndex(h => h.id === id);
      if (hostIndex !== -1) {
        this.cache.t_hosts[hostIndex] = response.data;
      } else {
        this.cache.t_hosts.push(response.data);
      }
      
      return response.data;
    } catch (error) {
      logger.error(`Error fetching host ${id}:`, error);
      throw error;
    }
  }

  /**
   * Add a new host
   */
  async addHost(host: Omit<Host, 'id'>): Promise<Host> {
    try {
      const response = await apiClient.post(`/hosts`, host);
      this.cache.t_hosts.push(response.data);
      return response.data;
    } catch (error) {
      logger.error('Error creating host:', error);
      throw error;
    }
  }
  /**
   * Update an existing host
   */  async updateHost(id: string, host: Partial<Host>): Promise<Host | undefined> {
    try {
      logger.info(`🔄 StorageService: Updating host ${id} with data:`, host);
      
      // Asegurarse de que tenemos un ID válido
      if (!id) {
        const errorMsg = "Cannot update host - missing ID";
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }
      
      // Log de la petición que vamos a hacer (mostrar con mucho detalle)
      logger.info(`🔄 Making PUT request to /hosts/${id}`, {
        endpoint: `/api/hosts/${id}`,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer [TOKEN_REDACTED]'
        },
        body: JSON.stringify(host)
      });
        // Usar apiClient en lugar de fetch para asegurar que se incluye el token correcto
      let response;
      try {
        // Usar apiClient que ya tiene configurada la autenticación correctamente
        logger.info(`Using apiClient to call PUT /hosts/${id}`);
        
        const apiResponse = await apiClient.put(`/hosts/${id}`, host);
        
        // Convertir la respuesta de axios a un formato similar al de fetch para mantener compatibilidad
        response = {
          ok: true,
          status: apiResponse.status,
          statusText: apiResponse.statusText,
          json: async () => apiResponse.data,
          text: async () => JSON.stringify(apiResponse.data)
        };
        
        logger.info(`✅ Successful response from apiClient: ${apiResponse.status}`);
      } catch (networkError: any) {
        // Manejo específico para errores de red
        logger.error(`❌ Network error with apiClient: ${networkError.message}`);
        console.error(`Network error with apiClient:`, networkError);
        
        // Si hay un error de respuesta (ej: 401, 403, etc), crear un objeto response para manejar consistentemente
        if (networkError.response) {
          response = {
            ok: false,
            status: networkError.response.status,
            statusText: networkError.response.statusText,
            json: async () => networkError.response.data,
            text: async () => JSON.stringify(networkError.response.data)
          };
        } else {
          throw new Error(`Network error: ${networkError.message}`);
        }
      }
        // Ahora procesamos la respuesta
      if (!response.ok) {
        let errorText = "";
        try {
          errorText = await response.text();
        } catch (e) {
          errorText = "Could not read error response";
        }
        
        logger.error(`❌ Error from server: Status ${response.status}:`, {
          status: response.status,
          statusText: response.statusText,
          bodyText: errorText
        });
        console.error(`Error from server: Status ${response.status} ${response.statusText}:`, errorText);
        throw new Error(`Server error: ${response.status} ${errorText}`);
      }
      
      // Procesar la respuesta exitosa
      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        logger.error(`❌ Error parsing JSON response: ${(jsonError as Error).message}`);
        console.error(`Error parsing JSON response:`, jsonError);
        throw new Error(`Error parsing server response: ${(jsonError as Error).message}`);
      }
      
      // Log de respuesta exitosa
      logger.info(`✅ Host ${id} updated successfully, response:`, data);
      
      // Update cache
      const index = this.cache.t_hosts.findIndex(h => h.id === id);
      if (index !== -1) {
        this.cache.t_hosts[index] = data;
        logger.info(`✅ Updated host in cache at index ${index}`);
      } else {
        logger.warn(`⚠️ Host ${id} not found in cache after update`);
      }
      
      return data;
    } catch (error) {
      logger.error(`❌ Error updating host ${id}:`, error);
      console.error(`❌ Error updating host ${id}:`, error);
      throw error;
    }
  }
  /**
   * Delete a host
   */
  async deleteHost(id: string): Promise<boolean> {
    try {
      await apiClient.delete(`/hosts/${id}`);
      this.cache.t_hosts = this.cache.t_hosts.filter(host => host.id !== id);
      return true;
    } catch (error: any) {
      logger.error(`Error deleting host ${id}:`, error);
      
      // Check if it's a structured API error with a message
      if (error.response && error.response.data && error.response.data.error) {
        throw new Error(error.response.data.error);
      }
      
      throw error;
    }
  }

  /**
   * Delete all hosts for the current customer
   */
  async deleteAllHosts(customerId: string): Promise<number> {
    const res = await apiClient.delete(`/hosts/all?customerId=${customerId}`);
    this.cache.t_hosts = [];
    return res.data.deleted || 0;
  }

  /**
   * Clone a host and optionally its VMs
   */
  async cloneHost(id: string, newName: string, cloneVirtualHosts: boolean = false): Promise<Host | undefined> {
    try {
      // Llamar al endpoint con la ruta correcta
      logger.info(`Cloning host with ID: ${id}, newName: ${newName}, cloneVMs: ${cloneVirtualHosts}`);
      const response = await apiClient.post(`/hosts/${id}/clone`, {
        newName,
        cloneVirtualHosts
      });
      
      // Agregar el host clonado al caché
      this.cache.t_hosts.push(response.data);
      
      // Si se clonaron VMs, agregarlas también al caché
      if (response.data.clonedVms && Array.isArray(response.data.clonedVms)) {
        this.cache.t_hosts = [...this.cache.t_hosts, ...response.data.clonedVms];
      }
      
      return response.data;
    } catch (error) {
      logger.error(`Error cloning host ${id}:`, error);
      throw error;
    }
  }

  // ENVIRONMENT CRUD METHODS

  /**
   * Get all environments
   */
  async getEnvironments(): Promise<Environment[]> {
    // Verificar autenticación antes de hacer la solicitud
    if (!authService.isAuthenticated()) {
      console.warn('StorageService: Intentando acceder a datos de environments sin autenticación');
      return [];
    }
    
    try {
      const customerId = this.getSelectedCustomerId();
      let url = `/environments`;
      
      if (customerId) {
        url += `?customerId=${customerId}`;
      }
      
      const response = await apiClient.get(url);
      this.cache.t_environments = response.data;
      return response.data;
    } catch (error) {
      logger.error('Error fetching environments:', error);
      throw error;
    }
  }

  /**
   * Get all environments for a specific customer
   * @param customerId The ID of the customer to get environments for (optional - uses selected customer if not provided)
   * @returns Promise<Environment[]> The environments for the customer
   */
  async getEnvironmentsByCustomer(customerId?: string | null): Promise<Environment[]> {
    try {
      // If no customerId provided, use the selected customer ID
      const customerIdToUse = customerId || this.getSelectedCustomerId();
      
      // If still no customerId, return empty array
      if (!customerIdToUse) {
        console.warn('No customerId provided to getEnvironmentsByCustomer and no customer selected');
        return [];
      }

      const response = await apiClient.get(`/environments?customerId=${customerIdToUse}`);
      
      // Update cache with these environments
      const existingEnvironments = this.cache.t_environments.filter(e => e.customerId !== customerIdToUse);
      this.cache.t_environments = [...existingEnvironments, ...response.data];
      
      return response.data;
    } catch (error) {
      logger.error(`Error fetching environments for customer ${customerId}:`, error);
      throw error;
    }
  }

  /**
   * Get environment by ID
   */
  async getEnvironment(id: string): Promise<Environment | undefined> {
    try {
      const response = await apiClient.get(`/environments/${id}`);
      
      // Update cache
      const envIndex = this.cache.t_environments.findIndex(e => e.id === id);
      if (envIndex !== -1) {
        this.cache.t_environments[envIndex] = response.data;
      } else {
        this.cache.t_environments.push(response.data);
      }
      
      return response.data;
    } catch (error) {
      logger.error(`Error fetching environment ${id}:`, error);
      throw error;
    }
  }

  /**
   * Add a new environment
   */
  async addEnvironment(environment: Omit<Environment, 'id'>): Promise<Environment> {
    try {
      const response = await apiClient.post(`/environments`, environment);
      this.cache.t_environments.push(response.data);
      return response.data;
    } catch (error) {
      logger.error('Error creating environment:', error);
      throw error;
    }
  }

  async validateEnvironmentDraft(draft: {
    customerId: string;
    environmentId?: string;
    name?: string;
    type?: string;
    version?: string;
    edition?: string;
    dbType?: string;
    instances?: Array<{
      id?: string;
      name?: string;
      hostId?: string;
      environmentId?: string;
      isPrimary?: boolean;
      status?: string;
    }>;
  }): Promise<{
    normalizedValues: { edition?: string; dbType?: string };
    errors: {
      environmentName?: string;
      instanceName?: string;
      hostId?: string;
      form: string[];
    };
    isValid: boolean;
  }> {
    const response = await apiClient.post(`/environments/validate-draft`, draft);
    return response.data;
  }

  /**
   * Update an existing environment
   */
  async updateEnvironment(id: string, environment: Partial<Environment>): Promise<Environment | undefined> {
    try {
      const response = await apiClient.put(`/environments/${id}`, environment);
      
      const index = this.cache.t_environments.findIndex(e => e.id === id);
      if (index !== -1) {
        this.cache.t_environments[index] = response.data;
      }
      
      return response.data;
    } catch (error) {
      logger.error(`Error updating environment ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete an environment
   */
  async deleteEnvironment(id: string): Promise<boolean> {
    try {
      await apiClient.delete(`/environments/${id}`);
      this.cache.t_environments = this.cache.t_environments.filter(env => env.id !== id);
      return true;
    } catch (error) {
      logger.error(`Error deleting environment ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete all environments for the current customer
   */
  async deleteAllEnvironments(customerId: string): Promise<number> {
    const res = await apiClient.delete(`/environments/all?customerId=${customerId}`);
    this.cache.t_environments = [];
    return res.data.deleted || 0;
  }

  /**
   * Clone an environment
   */
  async cloneEnvironment(id: string, newName: string): Promise<Environment | undefined> {
    try {
      // Llamar al nuevo endpoint específico en lugar de implementar la lógica aquí
      const response = await apiClient.post(`/environments/${id}/clone`, {
        newName
      });
      
      // Agregar el entorno clonado al caché
      this.cache.t_environments.push(response.data);
      
      return response.data;
    } catch (error) {
      logger.error(`Error cloning environment ${id}:`, error);
      throw error;
    }
  }

  // CUSTOMER METHODS

  /**
   * Get all customers
   * @param params Optional URL search params for filtering
   */
  async getCustomers(params?: URLSearchParams): Promise<Customer[]> {
    // Verificar autenticación antes de hacer la solicitud
    if (!authService.isAuthenticated()) {
      console.warn('StorageService: Intentando acceder a datos de customers sin autenticación');
      return [];
    }
    
    try {
      // Construir URL con parámetros de consulta si se proporcionan
      let url = `/customers`;
      if (params && params.toString()) {
        url += `?${params.toString()}`;
      }
      
      const response = await apiClient.get(url);
      
      // Update cache
      this.cache.t_customers = response.data;
      
      return response.data;
    } catch (error) {
      logger.error('Error fetching customers:', error);
      throw error;
    }
  }

  /**
   * Get customer by ID
   */
  async getCustomer(id: string): Promise<Customer | undefined> {
    try {
      const response = await apiClient.get(`/customers/${id}`);
      
      // Update cache
      if (!Array.isArray(this.cache.t_customers)) {
        this.cache.t_customers = [];
      }
      
      const customerIndex = this.cache.t_customers.findIndex(c => c.id === id);
      if (customerIndex !== -1) {
        this.cache.t_customers[customerIndex] = response.data;
      } else {
        this.cache.t_customers.push(response.data);
      }
      
      return response.data;
    } catch (error) {
      logger.error(`Error fetching customer ${id}:`, error);
      throw error;
    }
  }

  /**
   * Add a new customer
   */
  async addCustomer(customer: Omit<Customer, 'id' | 'createdAt'>): Promise<Customer> {
    try {
      const response = await apiClient.post(`/customers`, {
        ...customer,
        createdAt: new Date().toISOString()
      });
      
      this.cache.t_customers.push(response.data);
      return response.data;
    } catch (error) {
      logger.error('Error creating customer:', error);
      throw error;
    }
  }

  /**
   * Update an existing customer
   */
  async updateCustomer(id: string, customer: Partial<Customer>): Promise<Customer | undefined> {
    try {
      const response = await apiClient.put(`/customers/${id}`, customer);
      
      // Update cache
      const index = this.cache.t_customers.findIndex(c => c.id === id);
      if (index !== -1) {
        this.cache.t_customers[index] = response.data;
      }
      
      return response.data;
    } catch (error) {
      logger.error(`Error updating customer ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete a customer
   */
  async deleteCustomer(id: string): Promise<boolean> {
    // First, check if the customer exists
    const customer = await this.getCustomer(id);
    if (!customer) return false;

    try {
      // Llamar al endpoint de eliminación en cascada en el servidor
      await apiClient.delete(`/customers/${id}`);
      
      // Actualizar el caché local después de la eliminación exitosa
      this.cache.t_customers = this.cache.t_customers.filter(c => c.id !== id);
      this.cache.t_hosts = this.cache.t_hosts.filter(h => h.customerId !== id);
      this.cache.t_environments = this.cache.t_environments.filter(e => e.customerId !== id);
      this.cache.t_licenses = this.cache.t_licenses.filter(l => l.customerId !== id);
      
      // Limpiar el cliente seleccionado si era éste
      if (this.getSelectedCustomerId() === id) {
        this.setSelectedCustomerId(null);
      }
      
      return true;
    } catch (error) {
      logger.error(`Error deleting customer ${id}:`, error);
      throw error;
    }
  }

  // CUSTOMER SELECTION METHODS

  /**
   * Get currently selected customer ID
   */
  getSelectedCustomerId(): string | null {
    try {
      return localStorage.getItem(SELECTED_CUSTOMER_KEY);
    } catch (error) {
      logger.error('Error getting selected customer:', error);
      return null;
    }
  }

  /**
   * Set selected customer
   */
  setSelectedCustomerId(customerId: string | null): void {
    try {
      if (customerId) {
        localStorage.setItem(SELECTED_CUSTOMER_KEY, customerId);
      } else {
        localStorage.removeItem(SELECTED_CUSTOMER_KEY);
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(CUSTOMER_SELECTION_EVENT, {
            detail: { customerId },
          })
        );
      }
    } catch (error) {
      logger.error('Error setting selected customer:', error);
    }
  }

  /**
   * Get currently selected customer
   */
  async getSelectedCustomer(): Promise<Customer | null> {
    try {
      const selectedId = this.getSelectedCustomerId();
      if (!selectedId) return null;

      const customer = await this.getCustomer(selectedId);
      return customer || null;
    } catch (error) {
      logger.error('Error getting selected customer:', error);
      return null;
    }
  }

  /**
   * Check if any customers exist
   */
  async hasCustomers(): Promise<boolean> {
    const customers = await this.getCustomers();
    return customers.length > 0;
  }

  /**
   * Check if a customer is currently selected
   */
  async hasSelectedCustomer(): Promise<boolean> {
    const selectedId = this.getSelectedCustomerId();
    if (!selectedId) return false;
    
    const customer = await this.getCustomer(selectedId);
    return !!customer && customer.active;
  }

  // REFERENCE DATA METHODS

  /**
   * Get license products from the database
   */
  async getLicenseProducts(): Promise<{ product: string, onlyEnterprise: boolean }[]> {
    try {
      const response = await apiClient.get(`/reference/licenseProducts`);
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      logger.error('Error fetching license products:', error);
      // Return empty array in case of error
      return [];
    }
  }

  /**
   * Get environment types from the database
   */
  async getEnvironmentTypes(): Promise<string[]> {
    try {
      const response = await apiClient.get(`/reference/environmentTypes`);
      return response.data.map((item: { envType: string }) => item.envType);
    } catch (error) {
      logger.error('Error fetching environment types:', error);
      throw error;
    }
  }

  /**
   * Get database editions from the database
   */
  async getDatabaseEditions(): Promise<string[]> {
    try {
      const response = await apiClient.get(`/reference/databaseEditions`);
      return response.data.map((item: { databaseEdition: string }) => item.databaseEdition);
    } catch (error) {
      logger.error('Error fetching database editions:', error);
      throw error;
    }
  }

  /**
   * Get database types from the database
   */
  async getDatabaseTypes(): Promise<string[]> {
    try {
      const response = await apiClient.get(`/reference/databaseTypes`);
      return response.data.map((item: { tenantType: string }) => item.tenantType);
    } catch (error) {
      logger.error('Error fetching database types:', error);
      throw error;
    }
  }

  /**
   * Get database versions from the database
   */
  async getDatabaseVersions(): Promise<string[]> {
    try {
      const response = await apiClient.get(`/reference/databaseVersions`);
      return response.data.map((item: { databaseVersion: string }) => item.databaseVersion);
    } catch (error) {
      logger.error('Error fetching database versions:', error);
      throw error;
    }
  }

  /**
   * Get primary uses from the database
   */
  async getPrimaryUses(): Promise<string[]> {
    try {
      const response = await apiClient.get(`/reference/primaryUses`);
      
      // Improved error handling
      if (!response.data || !Array.isArray(response.data)) {
        console.warn('Invalid primary uses response:', response.data);
        return [];
      }
      
      return response.data.map((item: { primaryUse: string }) => item.primaryUse);
    } catch (error: unknown) {
      logger.error('Error fetching primary uses:', error);
      if (axios.isAxiosError(error)) {
        logger.error('Axios error details:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          url: `/reference/primaryUses`
        });
      }
      // Return empty array instead of throwing to avoid UI crashes
      return [];
    }
  }

  /**
   * Get virtualization types from the database
   */
  async getVirtualizationTypes(): Promise<string[]> {
    try {
      const response = await apiClient.get(`/reference/virtualizationTypes`);
      
      // Improved error handling
      if (!response.data || !Array.isArray(response.data)) {
        console.warn('Invalid virtualization types response:', response.data);
        return [];
      }
      
      return response.data.map((item: { virtType: string }) => item.virtType);
    } catch (error: unknown) {
      logger.error('Error fetching virtualization types:', error);
      if (axios.isAxiosError(error)) {
        logger.error('Axios error details:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          url: `/reference/virtualizationTypes`
        });
      }
      // Return empty array instead of throwing to avoid UI crashes
      return [];
    }
  }

  /**
   * Get CPU models with their core factors from the database
   */
  async getCpuModelsWithFactors(): Promise<{ [key: string]: number }> {
    try {
      const response = await apiClient.get(`/reference/coreFactors`);
      
      // Log the raw response for debugging
      
      // Handle empty or invalid response
      if (!response.data) {
        console.warn('⚡ CPU Models - Empty response from server');
        return {};
      }
      
      // Convert the response into a map of cpuModel: coreFactor
      const cpuModels: { [key: string]: number } = {};
      
      // Try to handle different response formats
      if (Array.isArray(response.data)) {
        // Format: Array of objects with cpuModel and coreFactor properties
        response.data.forEach((item: { cpuModel: string; coreFactor: number }) => {
          if (item && item.cpuModel && typeof item.coreFactor === 'number') {
            cpuModels[item.cpuModel] = item.coreFactor;
          }
        });
      } else if (typeof response.data === 'object' && response.data !== null) {
        // Format: Direct object mapping or object with data property
        
        // If it's a direct mapping of cpuModel:coreFactor key:value pairs
        if (!Array.isArray(response.data)) {
          // Check if there's standard format with cpuModel and coreFactor properties 
          // in each object inside an array
          if (response.data.data && Array.isArray(response.data.data)) {
            response.data.data.forEach((item: any) => {
              if (item && item.cpuModel && typeof item.coreFactor === 'number') {
                cpuModels[item.cpuModel] = item.coreFactor;
              }
            });
          } else {
            // Try to extract from object directly
            Object.entries(response.data).forEach(([key, value]: [string, any]) => {
              // Check if the value is an object with cpuModel and coreFactor
              if (value && typeof value === 'object') {
                if (value.cpuModel && typeof value.coreFactor === 'number') {
                  cpuModels[value.cpuModel] = value.coreFactor;
                }
              } else if (typeof value === 'number') {
                // Direct mapping where key is cpuModel and value is coreFactor
                cpuModels[key] = value;
              }
            });
          }
        }
      }
      
      // If we couldn't parse anything, try some additional parsing approaches
      if (Object.keys(cpuModels).length === 0) {
        
        // Check if the response is actually a string that needs parsing
        if (typeof response.data === 'string') {
          try {
            const parsed = JSON.parse(response.data);
            
            if (Array.isArray(parsed)) {
              parsed.forEach((item: any) => {
                if (item && item.cpuModel && typeof item.coreFactor === 'number') {
                  cpuModels[item.cpuModel] = item.coreFactor;
                }
              });
            } else if (typeof parsed === 'object' && parsed !== null) {
              Object.entries(parsed).forEach(([key, value]: [string, any]) => {
                if (typeof value === 'number') {
                  cpuModels[key] = value;
                } else if (value && typeof value === 'object' && value.cpuModel && typeof value.coreFactor === 'number') {
                  cpuModels[value.cpuModel] = value.coreFactor;
                }
              });
            }
          } catch (parseError) {
            logger.error('⚡ CPU Models - Failed to parse response as JSON:', parseError);
          }
        }
      }
      
      if (Object.keys(cpuModels).length === 0) {
        console.warn('⚡ CPU Models - Could not extract any CPU models from the response');
        // No fallback data - return empty object as requested
        return {};
      }
      
      return cpuModels;
    } catch (error: unknown) {
      logger.error('⚡ CPU Models - Error fetching CPU factors:', error);
      if (axios.isAxiosError(error)) {
        logger.error('⚡ CPU Models - Axios error details:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          url: `/reference/coreFactors`
        });
      }
      
      // Return empty object instead of fallback data as requested
      return {};
    }
  }

  // REFERENCE DATA MAINTENANCE METHODS
  
  /**
   * Get all reference tables metadata
   */
  async getReferenceTables(): Promise<any[]> {
    try {
      // Using the new Drizzle maintenance endpoint
      const response = await apiClient.get(`/maintenance/tables`);
      return response.data;
    } catch (error) {
      logger.error('Error fetching reference tables:', error);
      throw error;
    }
  }

  /**
   * Get values for a specific reference table
   */
  async getReferenceTableValues(tableId: string): Promise<any[]> {
    try {
      // Using the new Drizzle maintenance endpoint
      const response = await apiClient.get(`/maintenance/tables/${tableId}`);
      return response.data;
    } catch (error) {
      logger.error(`Error fetching values for reference table ${tableId}:`, error);
      throw error;
    }
  }

  /**
   * Add a new value to a reference table
   */
  async addReferenceValue(tableId: string, value: string, secondaryValue?: number): Promise<void> {
    try {
      const payload = { value };
      if (secondaryValue !== undefined) {
        Object.assign(payload, { secondaryValue });
      }
      // Using the new Drizzle maintenance endpoint
      await apiClient.post(`/maintenance/tables/${tableId}`, payload);
    } catch (error) {
      logger.error(`Error adding value to reference table ${tableId}:`, error);
      throw error;
    }
  }

  /**
   * Update a value in a reference table
   */
  async updateReferenceValue(tableId: string, oldValue: string, newValue: string, secondaryValue?: number): Promise<void> {
    try {
      const payload = { value: newValue };
      if (secondaryValue !== undefined) {
        Object.assign(payload, { secondaryValue });
      }
      // Using the new Drizzle maintenance endpoint
      await apiClient.put(`/maintenance/tables/${tableId}/${encodeURIComponent(oldValue)}`, payload);
    } catch (error) {
      logger.error(`Error updating value in reference table ${tableId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a value from a reference table
   */
  async deleteReferenceValue(tableId: string, value: string): Promise<void> {
    try {
      // Using the new Drizzle maintenance endpoint
      await apiClient.delete(`/maintenance/tables/${tableId}/${encodeURIComponent(value)}`);
    } catch (error) {
      logger.error(`Error deleting value from reference table ${tableId}:`, error);
      throw error;
    }
  }

  // DATA TABLE MAINTENANCE METHODS

  /**
   * Get PDBs data
   */
  async getPdbs(): Promise<any[]> {
    try {
      const response = await apiClient.get(`/pdbs`);
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      logger.error('Error fetching pdbs data:', error);
      return [];
    }
  }

  /**
   * Get Feature Stats data
   */  async getFeatureStats(environmentId?: string): Promise<any[]> {
    try {
      let url = `/data/feature-stats`;
      if (environmentId) {
        url += `?environmentId=${environmentId}`;
      }
      const response = await apiClient.get(url);
      return Array.isArray(response.data) ? response.data : [];    } catch (error) {
      logger.error(`Error fetching feature stats data:`, error);
      return [];
    }
  }
    /**
   * Update a feature stat for an environment
   * @param environmentId The environment ID
   * @param featureStat The feature stat data to save
   */
  async updateFeatureStat(environmentId: string, featureStat: any): Promise<any> {
    try {
      // Validación básica
      if (!environmentId) {
        throw new Error('Environment ID is required');
      }
      
      if (!featureStat.name) {
        throw new Error('Feature name is required');
      }
      
      // Preparar un objeto con solo los campos necesarios, omitiendo campos problemáticos
      const sanitizedFeatureStat: any = {
        name: featureStat.name,
        environmentId,
      };
      
      // Añadir status con un valor predeterminado si no existe
      if (featureStat.status) {
        sanitizedFeatureStat.status = featureStat.status;
      } else {
        // Necesitamos añadir un status ya que es requerido por la interfaz FeatureStat
        sanitizedFeatureStat.status = 'Not Licensed';
      }
      
      // Añadir campos opcionales SOLO si están definidos en el objeto original
      if (featureStat.currentlyUsed !== undefined) {
        sanitizedFeatureStat.currentlyUsed = Boolean(featureStat.currentlyUsed);
      }
      
      if (featureStat.detectedUsages !== undefined) {
        sanitizedFeatureStat.detectedUsages = parseInt(String(featureStat.detectedUsages || '0'), 10) || 0;
      }
      
      if (featureStat.firstUsageDate !== undefined) {
        sanitizedFeatureStat.firstUsageDate = featureStat.firstUsageDate;
      }
      
      if (featureStat.lastUsageDate !== undefined) {
        sanitizedFeatureStat.lastUsageDate = featureStat.lastUsageDate;
      }
            
      logger.debug(`Sending feature stat update with sanitized data:`, sanitizedFeatureStat);
      
      // If the featureStat has an ID, update it
      try {
        if (featureStat.id && featureStat.id > 0) {
          const response = await apiClient.put(`/data/feature-stats/${featureStat.id}`, sanitizedFeatureStat);
          return response.data;
        } else {
          // Otherwise create a new one
          const response = await apiClient.post(`/data/feature-stats`, sanitizedFeatureStat);
          return response.data;
        }
      } catch (apiError: any) {
        // Mejorar los mensajes de error para depuración
        if (apiError.response) {
          logger.error(`API Error: ${apiError.response.status}`, apiError.response.data);
        }
        throw apiError; // Re-lanzar para manejar más arriba
      }
    } catch (error) {
      logger.error(`Error updating feature stat for env ${environmentId}:`, error);
      throw error;
    }
  }
  
  /**
   * Update multiple feature stats for an environment at once
   * @param environmentId The environment ID
   * @param featureStats Array of feature stats to save
   */
  async updateFeatureStatsBatch(environmentId: string, featureStats: any[]): Promise<any> {
    try {
      // Validación básica
      if (!environmentId) {
        throw new Error('Environment ID is required');
      }
      
      if (!Array.isArray(featureStats) || featureStats.length === 0) {
        throw new Error('Feature stats array is required and cannot be empty');
      }
      
      // Preparar cada feature stat con solo los datos necesarios
      const sanitizedFeatureStats = featureStats.map(featureStat => {
        const sanitized: any = {
          name: featureStat.name,
          environmentId,
        };
        
        // Añadir id si existe
        if (featureStat.id && featureStat.id > 0) {
          sanitized.id = featureStat.id;
        }
        
        // Añadir status con un valor predeterminado si no existe
        if (featureStat.status) {
          sanitized.status = featureStat.status;
        } else {
          sanitized.status = 'Not Licensed';
        }
        
        // Añadir campos opcionales SOLO si están definidos en el objeto original
        if (featureStat.currentlyUsed !== undefined) {
          sanitized.currentlyUsed = Boolean(featureStat.currentlyUsed);
        }
        
        if (featureStat.detectedUsages !== undefined) {
          sanitized.detectedUsages = parseInt(String(featureStat.detectedUsages || '0'), 10) || 0;
        }
        
        if (featureStat.firstUsageDate !== undefined) {
          sanitized.firstUsageDate = featureStat.firstUsageDate;
        }
        
        if (featureStat.lastUsageDate !== undefined) {
          sanitized.lastUsageDate = featureStat.lastUsageDate;
        }
        
        return sanitized;
      });
        logger.debug(`Sending batch update for ${sanitizedFeatureStats.length} feature stats`);
      
      // Enviar todos los feature stats en una sola llamada
      const response = await apiClient.post(`/data/feature-stats-batch`, sanitizedFeatureStats);
      return response.data;
      } catch (error) {
      logger.error(`Error updating feature stats batch for env ${environmentId}:`, error);
      throw error;
    }
  }

  /**
   * Get Core Assignments data
   */
  async getCoreAssignments(): Promise<any[]> {
    try {
      const response = await apiClient.get(`/core-assignments`);
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      logger.error('Error fetching core assignments data:', error);
      return [];
    }
  }

  /**
   * Get Core License Mappings data
   */
  async getCoreLicenseMappings(): Promise<any[]> {
    try {
      const response = await apiClient.get(`/core-license-mappings`);
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      logger.error('Error fetching core license mappings data:', error);
      return [];
    }
  }
  /**
   * Get License Host Mappings data - deprecated
   * @deprecated This method is deprecated as licenseHostMappings table has been replaced by coreLicenseMappings
   */
  async getLicenseHostMappings(): Promise<any[]> {
    logger.warn('getLicenseHostMappings is deprecated - licenseHostMappings table has been replaced by coreLicenseMappings');
    return [];
  }

  /**
   * Get Compliance Runs data
   */
  async getComplianceRuns(): Promise<any[]> {
    try {
      const response = await apiClient.get(`/compliance-runs`);
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      logger.error('Error fetching compliance runs data:', error);
      return [];
    }
  }

  /**
   * Get Compliance Results data
   */
  async getComplianceResults(): Promise<any[]> {
    try {
      const response = await apiClient.get(`/compliance-results`);
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      logger.error('Error fetching compliance results data:', error);
      return [];
    }
  }

  /**
   * Get License Products where onlyEnterprise = true
   * Returns products that are only available in Enterprise Edition
   */
  async getLicenseProductsForEnterprise(): Promise<any[]> {
    try {
      const response = await apiClient.get(`/reference/licenseProducts?onlyEnterprise=true`);
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      logger.error('Error fetching enterprise license products:', error);
      return [];
    }
  }

  /**
   * Get License Products where type = "Option Pack" or type = "Feature"
   * Returns products that are options or features
   */
  async getLicenseProductsByType(): Promise<any[]> {
    try {
      const response = await apiClient.get(`/reference/licenseProducts?type=Option Pack,Feature`);
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      logger.error('Error fetching option pack and feature license products:', error);
      return [];
    }
  }

  /**
   * Get feature stats for an environment
   * @param environmentId Environment ID to query features for
   * @returns Array of feature stats
   */
  async getFeatureStatsByEnvironment(environmentId: string): Promise<any[]> {
    try {
      const response = await apiClient.get(`/environments/${environmentId}/feature-stats`);
      return response.data || [];
    } catch (error) {
      logger.error(`Failed to get feature stats for environment ${environmentId}:`, error);
      return [];
    }
  }
}

// Create and export a singleton instance
export const storageService = new StorageService();

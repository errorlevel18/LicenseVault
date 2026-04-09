import { storageService } from './storageService';
import { setSelectedCustomerId } from './selectedCustomer';
import { Customer } from './types';
import axios from 'axios';
import logger from "@/lib/logger"; // Importamos el logger

// Claves para almacenar los datos de autenticación en sessionStorage
// sessionStorage se borra al cerrar el navegador, forzando re-login
const AUTH_TOKEN_KEY = 'auth_token';
const AUTH_USER_KEY = 'auth_user';

// Interface para los datos de autenticación que se guardarán
interface AuthData {
  user: {
    id: string;
    name: string;
    role?: 'admin' | 'customer';
  };
  token: string;
}

// Interface para credenciales de login
interface LoginCredentials {
  username: string;
  password: string;
}

/**
 * Servicio que gestiona la autenticación de usuarios
 */
class AuthService {
  /**
   * Realiza el login del usuario
   * @param credentials Credenciales de login (username y password)
   * @returns Datos del usuario autenticado o null si falló
   */
  async login(credentials: LoginCredentials): Promise<AuthData | null> {
    try {
      // Verificar credenciales de cliente con la API
      const response = await axios.post('/api/auth/login', {
        username: credentials.username,
        password: credentials.password
      });
      
      const authResult = response.data;
      
      if (authResult.success && authResult.user && authResult.token) {
        // Los datos ya vienen con el formato correcto desde el servidor
        const authData: AuthData = {
          user: authResult.user,
          token: authResult.token
        };
        
        this.setAuthData(authData);
               
        // Establecer el ID del cliente automáticamente
        if (authResult.user.role === 'customer') {
          setSelectedCustomerId(authResult.user.id);
        } else {
          // Para el admin no establecemos customerID
          setSelectedCustomerId(null);
        }
        
        // Inicializar el storageService después de autenticar
        await storageService.initialize();
        
        return authData;
      }
      
      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error('Error durante el login:', error.response?.data || error.message);
      } else {
        logger.error('Error durante el login:', error);
      }
      return null;
    }
  }
  
  /**
   * Cierra la sesión del usuario actual
   */
  logout(): void {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_USER_KEY);
    // Also clear any legacy localStorage entries
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    setSelectedCustomerId(null);
  }
  
  /**
   * Verifica si hay un usuario autenticado
   */
  isAuthenticated(): boolean {
    return !!this.getToken();
  }
  
  /**
   * Obtiene el token de autenticación actual
   */
  getToken(): string | null {
    try {
      return sessionStorage.getItem(AUTH_TOKEN_KEY);
    } catch (error) {
      logger.error('Error getting auth token:', error);
      return null;
    }
  }
  
  /**
   * Obtiene los datos del usuario autenticado
   */
  getCurrentUser(): AuthData['user'] | null {
    try {
      const userStr = sessionStorage.getItem(AUTH_USER_KEY);
      return userStr ? JSON.parse(userStr) : null;
    } catch (error) {
      logger.error('Error getting current user:', error);
      return null;
    }
  }
  
  /**
   * Verifica si el usuario actual tiene rol de administrador
   */
  isAdmin(): boolean {
    const user = this.getCurrentUser();
    return user?.role === 'admin';
  }
  
  /**
   * Valida el token con el servidor para comprobar que sigue siendo válido
   * @returns true si el token es válido, false en caso contrario
   */
  async validateToken(): Promise<boolean> {
    try {
      const token = this.getToken();
      if (!token) return false;
      
      // Hacer una petición a un endpoint protegido para verificar si el token es válido
      await axios.get('/api/auth/validate', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      return true;
    } catch (error) {
      // Si ocurre un error (401 por token caducado), el token no es válido
      logger.warn('Token validation failed:', error);
      this.logout(); // Limpiar datos de sesión inválidos
      return false;
    }
  }
  
  /**
   * Guarda los datos de autenticación en sessionStorage
   */
  private setAuthData(authData: AuthData): void {
    try {
      sessionStorage.setItem(AUTH_TOKEN_KEY, authData.token);
      sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(authData.user));
    } catch (error) {
      logger.error('Error setting auth data:', error);
    }
  }
}

// Exportar una instancia única del servicio
export const authService = new AuthService();
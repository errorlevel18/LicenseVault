import React, { createContext, useContext, useState, useEffect } from 'react';
import { authService } from './authService';
import { storageService } from './storageService';
import logger from "@/lib/logger"; // Importamos el logger

// Define la interfaz para el usuario autenticado
interface AuthUser {
  id: string;
  name: string;
  role?: 'admin' | 'customer';
}

// Define la interfaz para las credenciales de login
interface LoginCredentials {
  username: string;
  password: string;
}

// Interfaz para el contexto de autenticación
interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (credentials: LoginCredentials) => Promise<boolean>;
  logout: () => void;
}

// Crear el contexto con un valor por defecto
const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isAdmin: false,
  login: async () => false,
  logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Cargar el usuario desde el almacenamiento local al inicio
  useEffect(() => {
    const loadUser = async () => {
      const currentUser = authService.getCurrentUser();
      
      if (currentUser) {
        // Verificar si el token es válido
        const isTokenValid = await authService.validateToken();
        
        if (isTokenValid) {
          setUser(currentUser);
          
          try {
            await storageService.initialize();
            logger.info('AuthContext: StorageService inicializado automáticamente para usuario existente');
          } catch (error) {
            logger.error('Error inicializando StorageService desde AuthContext:', error);
          }
        } else {
          // Si el token no es válido, no establecer el usuario
          setUser(null);
          logger.warn('AuthContext: Token inválido o caducado, redirigiendo al login');
        }
      }
      
      setIsLoading(false);
    };
    
    loadUser();
  }, []);

  // Función para realizar el login
  const login = async (credentials: LoginCredentials): Promise<boolean> => {
    const authData = await authService.login(credentials);
    if (authData) {
      setUser(authData.user);
      return true;
    }
    return false;
  };

  // Función para realizar el logout
  const logout = () => {
    authService.logout();
    setUser(null);
  };

  // Mientras se carga el usuario, no renderizar nada
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  // Proporcionar el contexto de autenticación
  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isAdmin: user?.role === 'admin',
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
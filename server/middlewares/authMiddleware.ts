import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';

// Constantes de configuración
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  logger.warn('JWT_SECRET not set — using insecure default. Set JWT_SECRET env var before deploying.');
  return 'license-vault-dev-only-secret';
})();
export const TOKEN_EXPIRATION = '24h'; // El token expira en 24 horas

// Extender la interfaz Request de Express para incluir el usuario autenticado
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        role: 'admin' | 'customer';
        customerId?: string; // Añadir el campo customerId
      };
    }
  }
}

// Middleware para verificar tokens JWT
export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  // Obtener el token del encabezado Authorization
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Formato: "Bearer TOKEN"
  
  // Si no hay token, denegar el acceso
  if (!token) {
    return res.status(401).json({ error: 'Acceso no autorizado - Token no proporcionado' });
  }
  
  try {
    // Verificar el token
    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: string;
      name: string;
      role: 'admin' | 'customer';
    };
    
    // Adjuntar los datos del usuario a la solicitud
    req.user = decoded;
    
    // Si el usuario es un cliente, establecer customerId igual a su ID
    if (decoded.role === 'customer') {
      req.user.customerId = decoded.id;
    }
    
    // Continuar con la siguiente función en la cadena de middleware
    next();
  } catch (error) {
    logger.error('Error de autenticación:', error);
    res.status(403).json({ error: 'Token inválido o expirado' });
  }
};

// Middleware para verificar si el usuario es administrador
export const isAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Acceso no autorizado' });
  }
  
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado - Se requieren permisos de administrador' });
  }
  
  next();
};

// Middleware para verificar si el usuario tiene acceso a un recurso específico de un cliente
export const hasCustomerAccess = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Acceso no autorizado' });
  }
  
  // Los administradores tienen acceso a todos los recursos de todos los clientes
  if (req.user.role === 'admin') {
    return next();
  }
  
  // Obtener el ID del cliente de los parámetros de la URL o de la consulta
  const customerId = req.params.customerId || req.query.customerId as string;
  
  // Si el usuario no es administrador, solo puede acceder a sus propios recursos
  if (customerId && req.user.id !== customerId) {
    return res.status(403).json({ error: 'Acceso denegado - No tiene permiso para acceder a este recurso' });
  }
  
  next();
};

// Función para generar tokens JWT
export const generateToken = (user: { id: string; name: string; role: 'admin' | 'customer' }): string => {
  return jwt.sign(user, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });
};
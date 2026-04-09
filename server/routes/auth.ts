import { Router } from 'express';
import { validateRequest } from '../middlewares/validationMiddleware';
import { loginSchema } from '../utils/validation-schemas';
import { safeOperation } from '../utils/error-handler';
import { customers } from '../../shared/schema';
import { eq, or } from 'drizzle-orm';
import logger from '../utils/logger';
import db from '../database';
import { generateToken, authenticate } from '../middlewares/authMiddleware';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';

const router = Router();

// Funciones de utilidad para contraseñas
export const hashPassword = async (password: string): Promise<string> => {
  if (!password) return '';
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
};

export const verifyPassword = async (plainPassword: string, hashedPassword: string): Promise<boolean> => {
  if (!plainPassword || !hashedPassword) return false;
  return await bcrypt.compare(plainPassword, hashedPassword);
};

// Limitar intentos de login para prevenir ataques de fuerza bruta
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 5, // limitar a 5 intentos por ventana por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión. Intente nuevamente más tarde.' }
});

// Login endpoint con rate limiting
router.post('/login', loginLimiter, validateRequest(loginSchema), async (req, res, next) => {
  try {
    const { username, password } = req.body;
    
    // Buscar cliente por nombre de usuario o nombre
    const customerData = await safeOperation(async () => {
      return await db
        .select()
        .from(customers)
        .where(
          or(
            eq(customers.username, username),
            eq(customers.name, username)
          )
        )
        .execute();
    }, 'Error during login');
    
    if (!customerData.length) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const customer = customerData[0];
    
    // Verificar si el cliente está activo
    if (!customer.active) {
      return res.status(401).json({ error: 'Account is inactive' });
    }
    
    // Denegar acceso si la cuenta no tiene contraseña configurada
    if (!customer.password) {
      logger.warn(`Login attempt for account without password: ${username}`);
      return res.status(401).json({ error: 'Account password not configured. Contact administrator.' });
    }
    
    // Verificar la contraseña
    if (await verifyPassword(password, customer.password)) {
      // Datos del usuario para el token, con tipo explícito para el role
      const userData: { id: string; name: string; role: 'admin' | 'customer' } = {
        id: customer.id,
        name: customer.name,
        role: (customer.role as 'admin' | 'customer') || 'customer'
      };
      
      // Generar el token JWT
      const token = generateToken(userData);
      
      // Registrar inicio de sesión exitoso (sin datos sensibles)
      logger.info(`User ${username} logged in successfully`);
      
      // Responder con los datos del usuario y el token
      return res.json({
        success: true,
        user: userData,
        token
      });
    }
    
    // Si llegamos aquí, las credenciales son inválidas
    return res.status(401).json({ error: 'Invalid credentials' });
  } catch (error) {
    next(error);
  }
});

// Endpoint para validar tokens
router.get('/validate', authenticate, (req, res) => {
  // Si llegamos aquí, el token es válido (authenticate middleware ya lo verificó)
  res.status(200).json({ valid: true, user: req.user });
});

export default router;

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import logger from '../utils/logger';

// Middleware para validar datos de request según un schema Zod
export function validateRequest(schema: ZodSchema<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validar combinando body, params y query según sea necesario
      const data = schema.parse({
        body: req.body,
        params: req.params,
        query: req.query,
      });

      // Reemplazar los datos validados
      req.body = data.body;
      req.params = data.params as Record<string, string>;
      req.query = data.query as Record<string, string>;
      
      next();
    } catch (error) {
      logger.warn({ path: req.path, error }, 'Validación de datos fallida');
      
      if (error instanceof ZodError) {
        // Formatear los errores de Zod para una mejor respuesta
        return res.status(400).json({
          error: 'Datos de entrada inválidos',
          details: error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      
      // Para otros errores
      return res.status(400).json({ 
        error: 'Error de validación de datos',
        message: (error as Error).message
      });
    }
  };
}
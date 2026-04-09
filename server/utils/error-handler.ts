import { Request, Response, NextFunction } from 'express';
import db from '../database';
import logger from './logger';

// Interfaz para errores personalizados
export interface AppError extends Error {
  status?: number;
  details?: string | Record<string, unknown>;
}

// Función para operaciones seguras que maneja errores automáticamente
export async function safeOperation<T>(
  operation: () => Promise<T>, 
  errorMessage: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logger.error(`${errorMessage}:`, error);
    const appError: AppError = new Error(errorMessage);
    appError.status = 500;
    appError.details = error instanceof Error ? error.message : String(error);
    throw appError;
  }
}

// Función de ayuda para operaciones de transacción
export async function withTransaction<T>(operation: (tx: any) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    return await operation(tx);
  });
}

// Middleware para manejo centralizado de errores
export function errorHandler(err: AppError, req: Request, res: Response, next: NextFunction) {
  const status = err.status || 500;
  const message = err.message || 'Ha ocurrido un error inesperado';
  
  logger.error({ 
    error: err, 
    path: req.path, 
    method: req.method
  }, message);
  
  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { details: err.details || err.stack })
  });
}
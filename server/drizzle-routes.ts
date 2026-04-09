import { Router } from 'express';
import customersRouter from './routes/customers';
import licensesRouter from './routes/licenses';
import environmentsRouter from './routes/environments';
import hostsRouter from './routes/hosts';
import maintenanceRouter from './routes/maintenance';
import complianceRouter from './routes/compliance';
import authRouter from './routes/auth';
import referenceRouter from './routes/reference';
import dataRouter from './routes/data';
import importRouter from './routes/import';
import osImportRouter from './routes/os-import';
import reviewLiteRouter from './routes/review-lite';
import { isAdmin } from './middlewares/authMiddleware';
import { errorHandler } from './utils/error-handler';
import logger from './utils/logger';

const router = Router();
logger.info(">>> [Drizzle Routes] Router created.");

// Ruta pública (sin autenticación)
router.use('/auth', authRouter);

// Rutas protegidas (la autenticación global se aplica en index.ts)
router.use('/customers', customersRouter);
router.use('/licenses', licensesRouter);
router.use('/environments', environmentsRouter);
router.use('/hosts', hostsRouter);
router.use('/maintenance', isAdmin, maintenanceRouter);
router.use('/compliance', complianceRouter);
router.use('/reference', referenceRouter);
router.use('/data', dataRouter);
router.use('/import', importRouter);
router.use('/os-import', osImportRouter);
router.use('/review-lite', reviewLiteRouter);

// Registrar el middleware de errores centralizado al final
router.use(errorHandler);

logger.info(">>> [Drizzle Routes] Router exported.");
export default router;
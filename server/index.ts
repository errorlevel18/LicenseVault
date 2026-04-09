import express from "express";
import cors from "cors";
import helmet from "helmet";
import drizzleMainRoutes from './drizzle-routes.js'; // Import drizzle routes
import { serveStatic } from "./static.js";
import { setupVite } from './vite.js';
import { createServer } from "http";
import { authenticate } from './middlewares/authMiddleware.js';
import logger from './utils/logger';

// Obtener el nivel de log desde la variable de entorno o por defecto
const logLevel = process.env.LOG_LEVEL || 'debug';
logger.info(`Log level set to: ${logLevel}`);

const app = express();
const server = createServer(app);
logger.info(">>> [Server] Express app created.");

// Log all incoming requests
app.use((req, res, next) => {
  logger.info(`>>> [Server] Incoming request: ${req.method} ${req.originalUrl}`);
  next();
});

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for SPA compatibility
  crossOriginEmbedderPolicy: false,
}));
logger.info(">>> [Server] Helmet security headers mounted.");

// CORS configuration - restrict to known origins
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : ['http://localhost:5000', 'http://localhost:5173'];

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (server-to-server, mobile apps, curl)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// CORS only for API routes (static files don't need CORS)
app.use('/api', cors(corsOptions));
logger.info(">>> [Server] CORS middleware mounted for /api.");
app.use(express.json({ limit: '1mb' }));
logger.info(">>> [Server] JSON parser middleware mounted.");

// Rutas públicas (sin autenticación)
const publicRoutes = [
  '/api/auth/login'
];

// ===== CONFIGURACIÓN DE RUTAS API =====
// Esta sección debe ir antes de cualquier middleware estático

// Middleware para autenticación API
app.use('/api', (req, res, next) => {
  // Saltar la autenticación para rutas públicas
  if (publicRoutes.some(route => req.originalUrl.includes(route))) {
    return next();
  }
  
  // Aplicar middleware de autenticación para el resto de rutas
  authenticate(req, res, next);
});

// Montar drizzleMainRoutes como fuente única de rutas API
app.use('/api', drizzleMainRoutes);
logger.info(">>> [Server] API routes mounted under /api.");

// ===== FIN DE CONFIGURACIÓN DE RUTAS API =====

// Error handler global
app.use((err: any, req: any, res: any, next: any) => {
  const statusCode = err.status || 500;
  logger.error({ 
    error: err.message, 
    stack: err.stack,
    status: statusCode,
    path: req.originalUrl,
    method: req.method
  }, 'Unhandled error');
  
  res.status(statusCode).json({ 
    error: err.message, 
    status: statusCode 
  });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  if (process.env.NODE_ENV === 'development') {
    await setupVite(app, server);
    logger.info(">>> [Server] Vite development middleware configured.");
  } else {
    serveStatic(app);
    logger.info(">>> [Server] Static file serving configured.");
  }

  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
}

startServer().catch((error) => {
  logger.error({ error }, 'Failed to start server');
  process.exit(1);
});

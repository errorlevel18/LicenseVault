import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger, type ViteDevServer, LogLevel, UserConfig } from "vite";
import { type Server } from "http";
import { fileURLToPath } from 'url';
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";
import logger from './utils/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const viteLogger = createLogger();

const log = (source: string, message: string) => {
  const formattedTime = new Date().toLocaleString();
  logger.info(`[${source}] ${message}`);
};

export async function setupVite(app: Express, server: Server) {
  logger.info(">>> [Vite Dev] Setting up Vite middleware...");
  const serverOptions: UserConfig = {
    server: {
      middlewareMode: true,
      hmr: { server },
    },
    appType: 'custom'
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg: string, options?: { error?: Error }) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    ...serverOptions,
  });

  // @ts-ignore - Vite's type definitions are not complete
  app.use(vite.middlewares);
  logger.info(">>> [Vite Dev] Vite middlewares mounted.");

  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    logger.info(`>>> [Vite Dev Catch-All] Handling request: ${url}`);

    // If the request path starts with /api, pass it to the next handler (likely drizzleMainRoutes)
    if (url.startsWith('/api')) {
      logger.info(`>>> [Vite Dev Catch-All] API request detected (${url}), passing to next handler.`);
      return next();
    }
    logger.info(`>>> [Vite Dev Catch-All] Non-API request (${url}), attempting to serve index.html.`);

    try {
      const clientTemplate = path.resolve(
        __dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      
      // @ts-ignore - Vite's type definitions are not complete
      const page = await vite.transformIndexHtml(url, template);
      logger.info(`>>> [Vite Dev Catch-All] Serving transformed index.html for ${url}.`);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      logger.error(`>>> [Vite Dev Catch-All] Error serving ${url}:`, e);
      // @ts-ignore - Vite's type definitions are not complete
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
  logger.info(">>> [Vite Dev] Catch-all middleware mounted.");
}

export function serveStatic(app: Express) {
  logger.info(">>> [Static Prod] Setting up static file serving...");
  const distPath = path.resolve(__dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));
  logger.info(`>>> [Static Prod] Static files served from: ${distPath}`);

  // Catch-all: Serve index.html for non-API routes
  app.use("*", (req, res, next) => {
    const url = req.originalUrl;
    logger.info(`>>> [Static Prod Catch-All] Handling request: ${url}`);
    // If the request path starts with /api, pass it to the next handler (likely an API route)
    if (url.startsWith('/api')) {
      logger.info(`>>> [Static Prod Catch-All] API request detected (${url}), passing to next handler.`);
      return next();
    }
    // Otherwise, serve the index.html file for client-side routing
    logger.info(`>>> [Static Prod Catch-All] Non-API request (${url}), serving index.html.`);
    res.sendFile(path.resolve(distPath, "index.html"));
  });
  logger.info(">>> [Static Prod] Catch-all middleware mounted.");
}

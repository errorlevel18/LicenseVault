import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import logger from './utils/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

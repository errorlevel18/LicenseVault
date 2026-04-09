import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/") ||
            id.includes("node_modules/wouter/") ||
            id.includes("node_modules/@tanstack/")
          ) {
            return "vendor-framework";
          }

          if (
            id.includes("node_modules/@radix-ui/") ||
            id.includes("node_modules/cmdk/") ||
            id.includes("node_modules/embla-carousel-react/") ||
            id.includes("node_modules/vaul/") ||
            id.includes("node_modules/lucide-react/")
          ) {
            return "vendor-ui";
          }

          if (
            id.includes("node_modules/react-hook-form/") ||
            id.includes("node_modules/@hookform/") ||
            id.includes("node_modules/zod/") ||
            id.includes("node_modules/date-fns/") ||
            id.includes("node_modules/axios/")
          ) {
            return "vendor-data";
          }

          if (id.includes("node_modules/reactflow/")) {
            return "vendor-reactflow";
          }

          if (
            id.includes("node_modules/recharts/") ||
            id.includes("node_modules/d3-")
          ) {
            return "vendor-charts";
          }

          if (
            id.includes("node_modules/xlsx/") ||
            id.includes("node_modules/html2canvas/") ||
            id.includes("node_modules/jspdf/") ||
            id.includes("node_modules/jspdf-autotable/")
          ) {
            return "vendor-export";
          }

          return "vendor-misc";
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",      // escucha en todas las interfaces
    port: 5173,            // opcional, puedes cambiarlo si está en uso
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});

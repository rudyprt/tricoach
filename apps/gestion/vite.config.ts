import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  // Recharts pèse à lui seul l'essentiel du paquet : acceptable pour un outil à usage unique.
  build: { outDir: "../dist/web", emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: {
    port: 5174,
    proxy: { "/api": { target: "http://localhost:3002", changeOrigin: true } },
  },
});

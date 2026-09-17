import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Les tests de composants rendent du JSX : sans ce greffon, vitest ne sait
  // pas le transformer.
  plugins: [react()],
  test: {
    // jsdom pour tous les fichiers : les tests de fonctions pures n'en ont pas
    // besoin, mais deux configurations à maintenir coûteraient plus cher que
    // les quelques millisecondes de démarrage.
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});

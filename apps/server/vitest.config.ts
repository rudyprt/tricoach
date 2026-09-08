import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Les suites d'intégration partagent une même base et la vident entre
    // chaque test : les exécuter en parallèle les ferait se marcher dessus.
    fileParallelism: false,
    testTimeout: 20000,
  },
});

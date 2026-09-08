import { z } from "zod";

/**
 * Les variables d'environnement sont validées une seule fois au démarrage : une
 * configuration incomplète doit faire échouer le boot avec un message clair,
 * plutôt que produire des 500 opaques à la première requête authentifiée.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, "DATABASE_URL est obligatoire."),
  JWT_SECRET: z.string().min(32, "JWT_SECRET doit faire au moins 32 caractères."),
  ANTHROPIC_API_KEY: z
    .string()
    .transform((v) => v.trim())
    .optional()
    .default(""),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  /**
   * Tant qu'aucun prestataire de paiement n'est branché, le passage en offre
   * payante depuis l'application est refusé en production. Mettre "open" en
   * développement ou pour une démo permet de tester les offres sans facturation.
   */
  BILLING_MODE: z.enum(["disabled", "open"]).default("disabled"),
  APP_URL: z.string().default("http://localhost:5173"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuration invalide (apps/server/.env) :\n${details}`);
  }
  return parsed.data;
}

export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

export function isProduction(): boolean {
  return env().NODE_ENV === "production";
}

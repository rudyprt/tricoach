import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3002),
  DATABASE_URL: z.string().min(1, "DATABASE_URL est obligatoire (la même base que l'application)."),
  /**
   * Secret propre à l'outil de gestion, distinct du JWT_SECRET de
   * l'application : une fuite de l'un n'ouvre pas l'autre.
   */
  GESTION_SECRET: z.string().min(32, "GESTION_SECRET doit faire au moins 32 caractères."),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) {
    // Une valeur collée depuis un téléphone arrive souvent avec un retour à la
    // ligne final : « production\n » faisait échouer le démarrage sur Render.
    const nettoye = Object.fromEntries(
      Object.entries(process.env).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])
    );
    const parsed = envSchema.safeParse(nettoye);
    if (!parsed.success) {
      const details = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Configuration invalide (apps/gestion) :\n${details}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function isProduction(): boolean {
  return env().NODE_ENV === "production";
}

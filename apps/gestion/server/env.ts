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
    const parsed = envSchema.safeParse(process.env);
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

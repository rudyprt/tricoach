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
  /**
   * Amorçage du premier administrateur sans accès à une ligne de commande :
   * les comptes EXISTANTS dont l'email figure ici obtiennent le rôle admin.
   * Séparer par des virgules. Réglable depuis le tableau de bord de
   * l'hébergeur, donc utilisable depuis un téléphone.
   */
  ADMIN_EMAILS: z.string().default(""),

  /**
   * Envoi d'e-mails (réinitialisation de mot de passe, vérification
   * d'adresse). Sans SMTP_HOST, les messages sont tracés dans les logs au lieu
   * d'être envoyés : l'application reste utilisable, mais la récupération de
   * compte ne fonctionne pas réellement.
   */
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  /** true pour une connexion TLS directe (port 465), false pour STARTTLS. */
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  MAIL_FROM: z.string().default("TriCoach <ne-pas-repondre@tricoach.app>"),

  /**
   * Remontée des erreurs serveur vers un service externe (Slack, Discord,
   * Sentry via son endpoint HTTP, ou tout récepteur acceptant du JSON).
   * Sans URL, les erreurs restent dans les logs.
   */
  ERROR_WEBHOOK_URL: z.string().default(""),
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

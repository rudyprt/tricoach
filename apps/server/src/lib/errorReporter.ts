import { env, isProduction } from "./env.js";

interface ErrorContext {
  method?: string;
  path?: string;
  userId?: string;
  statusCode?: number;
}

/** Évite d'inonder le récepteur si une même erreur se répète en boucle. */
const recentlySent = new Map<string, number>();
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

function shouldSend(signature: string): boolean {
  const now = Date.now();
  const last = recentlySent.get(signature);
  if (last && now - last < DEDUP_WINDOW_MS) return false;

  if (recentlySent.size > 500) {
    for (const [key, at] of recentlySent) {
      if (now - at > DEDUP_WINDOW_MS) recentlySent.delete(key);
    }
  }
  recentlySent.set(signature, now);
  return true;
}

/** Remet à zéro la déduplication (usage : tests). */
export function resetErrorReporter(): void {
  recentlySent.clear();
}

/**
 * Journalise une erreur serveur de façon structurée, et la pousse vers un
 * récepteur externe si l'on en a configuré un. Sans cela, une panne ne se
 * découvre que lorsqu'un athlète écrit pour se plaindre.
 *
 * L'envoi ne doit jamais faire échouer la requête : toute erreur de transport
 * est avalée.
 */
export function reportError(error: unknown, context: ErrorContext = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  console.error(
    JSON.stringify({
      niveau: "erreur",
      message,
      ...context,
      horodatage: new Date().toISOString(),
      stack,
    })
  );

  const url = env().ERROR_WEBHOOK_URL;
  if (!url) return;

  // La signature ignore l'identité de l'athlète : c'est le défaut qu'on
  // dédoublonne, pas la personne qui l'a rencontré.
  const signature = `${context.method ?? ""} ${context.path ?? ""} ${message}`;
  if (!shouldSend(signature)) return;

  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `TriCoach — erreur serveur${isProduction() ? " (production)" : ""}`,
      message,
      method: context.method,
      path: context.path,
      statusCode: context.statusCode,
      horodatage: new Date().toISOString(),
    }),
  }).catch((err) => console.error("Remontée d'erreur impossible :", err));
}

/**
 * Quel modèle pour quel appel, et combien il peut écrire.
 *
 * Le chat est l'appel le plus fréquent et le plus court : un modèle rapide et
 * peu coûteux y suffit. La construction d'une semaine d'entraînement est rare
 * et engage la santé de l'athlète : elle revient au modèle le plus capable.
 */

export const MODELE_CHAT = "claude-haiku-5-5";
export const MODELE_PLAN = "claude-opus-5-5";
export const MODELE_PLAN_COURSE = "claude-sonnet-5";

/**
 * Plafonds de sortie par type d'appel. Un plafond ne coûte rien tant qu'il
 * n'est pas atteint ; trop bas, il tronque la réponse et l'appel est perdu.
 * Ceux des plans incluent la réflexion du modèle, qui ne peut pas y être
 * désactivée.
 */
export const MAX_TOKENS = {
  chat: 600,
  resumeChat: 250,
  plan: 16000,
  ajustement: 12000,
  planCourse: 3500,
  analyseCourse: 3000,
} as const;

/** Modèles dont la réflexion est permanente : `thinking: disabled` y est refusé. */
export function reflexionPermanente(modele: string): boolean {
  return modele.startsWith("claude-opus-5-5") || modele.startsWith("claude-fable-5");
}

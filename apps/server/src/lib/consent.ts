/**
 * Version des conditions générales et de la politique de confidentialité.
 * L'incrémenter oblige les athlètes à re-consentir : une modification
 * substantielle des conditions ne peut pas s'appliquer sans nouvel accord.
 */
export const CONSENT_VERSION = "2026-09";

export interface ConsentState {
  consentAcceptedAt: Date | null;
  consentVersion: string | null;
}

export function hasCurrentConsent(user: ConsentState): boolean {
  return Boolean(user.consentAcceptedAt) && user.consentVersion === CONSENT_VERSION;
}

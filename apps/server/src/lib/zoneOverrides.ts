import { z } from "zod";
import { ZONE_SPORTS, type ZoneOverrides } from "./training.js";

/** Zones acceptées : celles produites par le calcul automatique. */
const ZONE_KEYS = ["Z1", "Z2", "Z3", "Z4", "Z5"] as const;

/**
 * Une valeur de zone est un texte libre court ("5:30/km", "218-252 W",
 * "~30 km/h") : elle est affichée et transmise au modèle, jamais interprétée
 * comme un nombre. On borne donc surtout sa longueur.
 */
const zoneValueSchema = z.string().trim().max(40, "40 caractères maximum par zone.");

const sportSchema = z
  .record(z.enum(ZONE_KEYS, { errorMap: () => ({ message: "Zone inconnue : utilisez Z1 à Z5." }) }), zoneValueSchema)
  .optional();

export const zoneOverridesSchema = z.object({
  course: sportSchema,
  natation: sportSchema,
  velo: sportSchema,
});

/**
 * La colonne est du JSON libre : elle peut contenir n'importe quelle forme si
 * un enregistrement est ancien ou corrompu. On la valide avant usage plutôt que
 * de faire confiance à sa structure.
 */
export function parseZoneOverrides(value: unknown): ZoneOverrides | null {
  if (!value || typeof value !== "object") return null;
  const parsed = zoneOverridesSchema.safeParse(value);
  if (!parsed.success) return null;

  const cleaned: ZoneOverrides = {};
  for (const sport of ZONE_SPORTS) {
    const entries = Object.entries(parsed.data[sport] ?? {}).filter(([, v]) => v && v.trim() !== "");
    if (entries.length > 0) cleaned[sport] = Object.fromEntries(entries) as Record<string, string>;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

import { z } from "zod";

/**
 * Paramètres de l'activité, modifiables depuis l'outil.
 *
 * Valeurs par défaut relevées en octobre 2026 pour une micro-entreprise de
 * prestations de services commerciales (BIC). À confirmer à la création :
 * c'est l'URSSAF qui classe l'activité, d'après le code APE.
 * Source de référence : https://www.autoentrepreneur.urssaf.fr
 */
export const parametresSchema = z.object({
  /** Date de début d'activité déclarée. Nulle : micro-entreprise pas encore créée, tout est simulé. */
  dateDebutActivite: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /** Cotisations sociales, en % du CA. BIC services : 21,2 ; BNC hors CIPAV : 25,6. */
  tauxCotisations: z.number().min(0).max(100),
  /** Contribution à la formation professionnelle, en % du CA. Commerçant : 0,1 ; libéral : 0,2. */
  tauxCfp: z.number().min(0).max(10),
  versementLiberatoire: z.boolean(),
  /** Impôt sur le revenu libératoire, en % du CA. BIC services : 1,7 ; BNC : 2,2. */
  tauxVersementLiberatoire: z.number().min(0).max(10),
  acre: z.boolean(),
  /**
   * Réduction des cotisations sociales pendant l'ACRE, en %. 50 pour une
   * création avant le 1er juillet 2026, 25 après.
   */
  reductionAcre: z.number().min(0).max(100),
  periodicite: z.enum(["mensuelle", "trimestrielle"]),
  /** Conversion des coûts IA, facturés en dollars. */
  tauxUsdEur: z.number().positive().max(10),
  /**
   * TVA ajoutée par Anthropic à la facture, en %. Un client européen sans
   * numéro de TVA valide la paie (20 % en France) : la micro-entreprise en
   * franchise ne la récupère pas, c'est donc un coût.
   */
  tvaSurIa: z.number().min(0).max(100),
  /** Prix mensuels affichés dans l'application, en centimes. */
  prixStandardCents: z.number().int().min(0),
  prixPremiumCents: z.number().int().min(0),
  /** Plafond annuel de CA du régime micro (services). */
  plafondCaCents: z.number().int().positive(),
  /** Franchise en base de TVA (services) : seuil de base et seuil majoré. */
  seuilTvaCents: z.number().int().positive(),
  seuilTvaMajoreCents: z.number().int().positive(),
});

export type Parametres = z.infer<typeof parametresSchema>;

export const PARAMETRES_PAR_DEFAUT: Parametres = {
  dateDebutActivite: null,
  tauxCotisations: 21.2,
  tauxCfp: 0.1,
  versementLiberatoire: false,
  tauxVersementLiberatoire: 1.7,
  acre: false,
  reductionAcre: 25,
  periodicite: "trimestrielle",
  tauxUsdEur: 0.86,
  tvaSurIa: 20,
  prixStandardCents: 1999,
  prixPremiumCents: 3490,
  plafondCaCents: 8_360_000,
  seuilTvaCents: 3_750_000,
  seuilTvaMajoreCents: 4_125_000,
};

/**
 * Lit la valeur enregistrée en complétant les champs absents : un paramètre
 * ajouté après coup ne doit pas rendre invalide la ligne déjà en base.
 */
export function lireParametres(valeurs: unknown): Parametres {
  const base = typeof valeurs === "object" && valeurs !== null ? valeurs : {};
  const parsed = parametresSchema.safeParse({ ...PARAMETRES_PAR_DEFAUT, ...base });
  return parsed.success ? parsed.data : PARAMETRES_PAR_DEFAUT;
}

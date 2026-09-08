/**
 * Identité de l'éditeur du service, affichée dans les mentions légales, les
 * conditions d'utilisation et la politique de confidentialité.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  C'EST LE SEUL FICHIER À REMPLIR. Remplacez chaque `null` par sa valeur.
 *  Tant qu'un champ obligatoire vaut `null`, les pages légales affichent un
 *  avertissement visible par vos utilisateurs.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ces informations sont obligatoires pour tout site professionnel accessible
 * en France (article 6 III de la loi pour la confiance dans l'économie
 * numérique).
 */

export type FormeJuridique = "micro-entreprise" | "societe";

export interface Editeur {
  /** "micro-entreprise" (auto-entrepreneur) ou "societe" (SAS, SARL, EURL...). */
  forme: FormeJuridique;
  /** Micro-entreprise : « Prénom Nom ». Société : la dénomination sociale. */
  nom: string | null;
  /** Société uniquement : « SAS », « SARL », « EURL »... */
  formeSociale: string | null;
  /** Société uniquement : capital social, ex. « 1 000 € ». */
  capital: string | null;
  /** Adresse complète du siège ou du domicile professionnel. */
  adresse: string | null;
  /** Micro-entreprise : SIREN à 9 chiffres. Société : « RCS Lyon 123 456 789 ». */
  immatriculation: string | null;
  /** Numéro de TVA intracommunautaire, si vous y êtes assujetti. */
  tva: string | null;
  /** Adresse de contact, obligatoire et réellement relevée. */
  email: string | null;
  /** Téléphone. Obligatoire pour un service payant à distance. */
  telephone: string | null;
  /** Personne responsable du contenu publié. */
  directeurPublication: string | null;
  /** Hébergeur du service : nom, adresse et téléphone. */
  hebergeur: string | null;
}

export const EDITEUR: Editeur = {
  forme: "micro-entreprise",
  nom: null,
  formeSociale: null,
  capital: null,
  adresse: null,
  immatriculation: null,
  tva: null,
  email: null,
  telephone: null,
  directeurPublication: null,
  hebergeur: "Render Services, Inc., 525 Brannan Street, Suite 300, San Francisco, CA 94107, États-Unis",
};

/** Champs sans lesquels les mentions légales sont incomplètes. */
function champsRequis(e: Editeur): (keyof Editeur)[] {
  const communs: (keyof Editeur)[] = [
    "nom",
    "adresse",
    "immatriculation",
    "email",
    "telephone",
    "directeurPublication",
    "hebergeur",
  ];
  return e.forme === "societe" ? [...communs, "formeSociale", "capital"] : communs;
}

export function champsManquants(e: Editeur = EDITEUR): (keyof Editeur)[] {
  return champsRequis(e).filter((champ) => !e[champ]);
}

export function editeurComplet(e: Editeur = EDITEUR): boolean {
  return champsManquants(e).length === 0;
}

/** Libellés lisibles, pour dire précisément ce qui manque. */
export const LIBELLES: Record<keyof Editeur, string> = {
  forme: "Forme juridique",
  nom: "Nom ou dénomination sociale",
  formeSociale: "Forme sociale (SAS, SARL...)",
  capital: "Capital social",
  adresse: "Adresse du siège",
  immatriculation: "Numéro SIREN ou RCS",
  tva: "TVA intracommunautaire",
  email: "Adresse e-mail de contact",
  telephone: "Téléphone",
  directeurPublication: "Directeur de la publication",
  hebergeur: "Hébergeur",
};

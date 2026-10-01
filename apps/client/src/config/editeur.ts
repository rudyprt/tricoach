/**
 * Identité de l'éditeur du service, affichée dans les mentions légales, les
 * conditions d'utilisation et la politique de confidentialité.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  C'EST LE SEUL FICHIER À REMPLIR. Tant qu'un champ OBLIGATOIRE vaut `null`,
 *  les pages légales affichent un avertissement visible par vos utilisateurs.
 *  Ce qui est obligatoire dépend de `professionnel` : voir ce champ.
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
  /**
   * L'ÉDITEUR, et non l'application. Micro-entreprise : « Prénom Nom » — une
   * personne physique ne peut pas se déclarer sous une marque seule. Société :
   * la dénomination sociale.
   */
  nom: string | null;
  /** Nom commercial du service, s'il diffère de celui de l'éditeur. */
  nomCommercial: string | null;
  /**
   * `false` tant que le service est gratuit et édité à titre non professionnel.
   *
   * La loi n'exige alors ni immatriculation, ni téléphone, ni adresse publique :
   * un particulier qui édite sans activité professionnelle peut s'en tenir au
   * nom de son hébergeur, à condition d'avoir communiqué son identité à
   * celui-ci (LCEN, article 6 III 2). Les réclamer malgré tout afficherait un
   * avertissement permanent que rien ne permettrait de lever.
   *
   * Passez-le à `true` en même temps que le premier paiement : les trois
   * champs redeviennent obligatoires, et l'avertissement le rappellera.
   */
  professionnel: boolean;
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
  nom: "Rudy Perret",
  nomCommercial: "TriCoach",
  professionnel: false,
  formeSociale: null,
  capital: null,
  adresse: null,
  immatriculation: null,
  tva: null,
  email: "tricoachia@gmail.com",
  telephone: null,
  directeurPublication: "Rudy Perret",
  hebergeur: "Render Services, Inc., 525 Brannan Street, Suite 300, San Francisco, CA 94107, États-Unis",
};

/**
 * Champs sans lesquels les mentions légales sont incomplètes.
 *
 * Ce qu'il faut publier dépend de l'activité, pas seulement de la forme : un
 * service gratuit édité sans activité professionnelle n'a pas de numéro à
 * donner, et lui en réclamer un laisserait l'avertissement allumé pour
 * toujours.
 */
function champsRequis(e: Editeur): (keyof Editeur)[] {
  const communs: (keyof Editeur)[] = ["nom", "email", "directeurPublication", "hebergeur"];
  if (!e.professionnel) return communs;

  const professionnels: (keyof Editeur)[] = [...communs, "adresse", "immatriculation", "telephone"];
  return e.forme === "societe" ? [...professionnels, "formeSociale", "capital"] : professionnels;
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
  nomCommercial: "Nom commercial",
  professionnel: "Activité professionnelle",
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

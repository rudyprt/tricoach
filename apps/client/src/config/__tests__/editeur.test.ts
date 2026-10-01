import { describe, expect, it } from "vitest";
import { champsManquants, editeurComplet, type Editeur } from "../editeur";

/**
 * Les mentions légales sont obligatoires pour un site professionnel. Ces tests
 * garantissent que l'application sait dire précisément ce qui manque, plutôt
 * que de publier des pages incomplètes en silence.
 */
const base: Editeur = {
  forme: "micro-entreprise",
  nom: "Rudy Exemple",
  nomCommercial: "Exemple",
  professionnel: true,
  formeSociale: null,
  capital: null,
  adresse: "1 rue du Stade, 69000 Lyon",
  immatriculation: "123456789",
  tva: null,
  email: "contact@exemple.fr",
  telephone: "06 00 00 00 00",
  directeurPublication: "Rudy Exemple",
  hebergeur: "Render Services, Inc.",
};

describe("identité de l'éditeur", () => {
  it("considère une micro-entreprise complète sans capital ni forme sociale", () => {
    expect(editeurComplet(base)).toBe(true);
    expect(champsManquants(base)).toEqual([]);
  });

  it("exige capital et forme sociale pour une société", () => {
    const societe: Editeur = { ...base, forme: "societe" };
    expect(editeurComplet(societe)).toBe(false);
    expect(champsManquants(societe)).toEqual(["formeSociale", "capital"]);

    const complete: Editeur = { ...societe, formeSociale: "SAS", capital: "1 000 €" };
    expect(editeurComplet(complete)).toBe(true);
  });

  it("nomme chaque champ manquant, pour savoir quoi remplir", () => {
    const vide: Editeur = { ...base, nom: null, email: null, telephone: null };
    expect(champsManquants(vide)).toEqual(["nom", "email", "telephone"]);
  });

  it("ne réclame pas la TVA, qui n'est pas toujours applicable", () => {
    expect(champsManquants({ ...base, tva: null })).toEqual([]);
  });

  it("n'exige ni numéro ni adresse tant que l'activité n'est pas professionnelle", () => {
    /*
     * Un particulier qui édite un service gratuit n'a pas de numéro à donner.
     * Lui en réclamer un laisserait l'avertissement allumé pour toujours,
     * sans aucun moyen de l'éteindre.
     */
    const amateur: Editeur = {
      ...base,
      professionnel: false,
      adresse: null,
      immatriculation: null,
      telephone: null,
    };
    expect(champsManquants(amateur)).toEqual([]);
    expect(editeurComplet(amateur)).toBe(true);
  });

  it("réclame les trois dès le passage au professionnel", () => {
    // C'est le moment du premier paiement : l'avertissement doit le rappeler.
    const devenuPro: Editeur = {
      ...base,
      professionnel: true,
      adresse: null,
      immatriculation: null,
      telephone: null,
    };
    expect(champsManquants(devenuPro)).toEqual(["adresse", "immatriculation", "telephone"]);
  });

  it("tient la configuration livrée pour complète", async () => {
    // L'éditeur a renseigné ce que la phase gratuite exige : les pages légales
    // ne doivent plus afficher d'avertissement aux athlètes.
    const { EDITEUR } = await import("../editeur");
    expect(champsManquants(EDITEUR)).toEqual([]);
    expect(editeurComplet(EDITEUR)).toBe(true);
  });
});

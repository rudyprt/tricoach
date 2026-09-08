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

  it("signale la configuration livrée comme incomplète", async () => {
    // Tant que l'éditeur n'a pas rempli ses informations, les pages légales
    // doivent afficher l'avertissement : c'est le comportement attendu.
    const { EDITEUR } = await import("../editeur");
    expect(editeurComplet(EDITEUR)).toBe(false);
  });
});

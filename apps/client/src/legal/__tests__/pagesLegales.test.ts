import { describe, expect, it } from "vitest";
import type { Editeur } from "../../config/editeur";
import { PAGES_LEGALES } from "../pagesLegales";
import sw from "../../../public/sw.js?raw";

/**
 * Les pages légales doivent rester lisibles sans JavaScript : un robot, un
 * vérificateur ou un navigateur dont le bundle échoue doit y trouver le texte.
 */
const complet: Editeur = {
  forme: "micro-entreprise",
  nom: "Rudy Exemple",
  nomCommercial: "Exemple",
  // Jeu d'essai d'un éditeur professionnel : c'est le cas le plus exigeant,
  // celui où numéro, adresse et téléphone sont tous obligatoires.
  professionnel: true,
  formeSociale: null,
  capital: null,
  adresse: "1 rue du Stade, 03700 Bellerive-sur-Allier",
  immatriculation: "123456789",
  tva: null,
  email: "contact@exemple.fr",
  telephone: "06 00 00 00 00",
  directeurPublication: "Rudy Exemple",
  hebergeur: "Render Services, Inc.",
};

function page(chemin: string) {
  const p = PAGES_LEGALES.find((x) => x.chemin === chemin);
  if (!p) throw new Error(`page ${chemin} absente`);
  return p;
}

describe("pages légales statiques", () => {
  it.each(PAGES_LEGALES)("$chemin est un document complet, sans aucun script", (p) => {
    const html = p.html(complet);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain(`<title>${p.titre} — TriCoach</title>`);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("Document incomplet");
  });

  it("affiche l'identité de l'éditeur dans les mentions légales", () => {
    const html = page("mentions-legales").html(complet);
    expect(html).toContain("Rudy Exemple");
    expect(html).toContain("SIREN");
    expect(html).toContain("123456789");
  });

  it("signale précisément ce qui manque quand l'éditeur est incomplet", () => {
    const html = page("confidentialite").html({ ...complet, email: null, telephone: null });
    expect(html).toContain("Document incomplet");
    expect(html).toContain("Adresse e-mail de contact, Téléphone");
    expect(html).toContain("[adresse e-mail à préciser]");
  });

  it("tait les mentions non dues plutôt que d'afficher des crochets vides", () => {
    /*
     * Un éditeur non professionnel n'a ni SIREN, ni téléphone, ni adresse à
     * publier. Les afficher en « [à compléter] » donnait à l'athlète une page
     * qui semblait inachevée, pour des renseignements que la loi ne réclame
     * pas encore à ce stade.
     */
    const amateur: Editeur = {
      ...complet,
      professionnel: false,
      adresse: null,
      immatriculation: null,
      telephone: null,
    };

    const mentions = page("mentions-legales").html(amateur);
    expect(mentions).not.toContain("à compléter");
    expect(mentions).not.toContain("SIREN");
    expect(mentions).not.toContain("Téléphone");
    // Ce qui reste doit suffire à identifier et joindre l'éditeur.
    expect(mentions).toContain("Rudy Exemple");
    expect(mentions).toContain("contact@exemple.fr");
    expect(mentions).toContain("non professionnel");

    const confidentialite = page("confidentialite").html(amateur);
    expect(confidentialite).not.toContain("adresse à préciser");
    expect(confidentialite).toContain("contact@exemple.fr");
  });

  it("réclame de nouveau ces mentions dès le passage au professionnel", () => {
    // C'est le moment du premier paiement : le vide redevient un manquement.
    const pro: Editeur = { ...complet, professionnel: true, immatriculation: null, telephone: null };
    const mentions = page("mentions-legales").html(pro);

    expect(mentions).toContain("SIREN");
    expect(mentions).toContain("Téléphone");
    expect(mentions).toContain("Document incomplet");
  });

  it("affiche le nom commercial à côté de celui de l'éditeur", () => {
    // « TriCoach » est le service ; l'éditeur est une personne. Les deux
    // doivent être lisibles, sans que l'un se fasse passer pour l'autre.
    const mentions = page("mentions-legales").html(complet);
    expect(mentions).toContain("Nom commercial");
    expect(mentions).toContain("Exemple");
  });

  it("échappe les valeurs saisies", () => {
    const html = page("mentions-legales").html({ ...complet, nom: "A <b>& B" });
    expect(html).toContain("A &lt;b&gt;&amp; B");
    expect(html).not.toContain("A <b>& B");
  });

  it("est ignorée par le service worker, qui la prendrait sinon pour la coquille", () => {
    const liste = sw.match(/const PAGES_STATIQUES = \[([^\]]*)\]/)?.[1] ?? "";
    for (const p of PAGES_LEGALES) expect(liste).toContain(`"/${p.chemin}"`);
  });
});

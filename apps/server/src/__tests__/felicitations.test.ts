import { describe, expect, it } from "vitest";
import { redigerFelicitations } from "../lib/felicitations.js";

/** Après une séance : bravo, ce qu'elle a été, comment en récupérer. */

const seance = (r: Record<string, unknown> = {}) => ({
  id: "s1",
  sport: "course",
  titre: "Sortie longue",
  dureeMin: 100,
  dureeReelleMin: null,
  distanceKm: 17,
  structure: null,
  ...r,
});

describe("félicitations après une séance", () => {
  it("résume la séance avec ses mesures", () => {
    const f = redigerFelicitations(seance(), {
      mesures: { distanceKm: 16.8, allureSecParKm: 357, fcMoyenne: 142 },
      niveauBilan: "conforme",
    });
    expect(f.titre).toBeTruthy();
    expect(f.resume[0]).toBe("Sortie longue : 100 min · 16,8 km · 5:57/km · FC moy 142.");
    expect(f.resume[1]).toContain("Conforme au plan");
  });

  it("insiste sur le sommeil et la récupération après une séance exigeante", () => {
    const f = redigerFelicitations(seance(), { prochaine: { titre: "Seuil 3 x 10 min", dansJours: 1, intense: true } });
    expect(f.recuperation.join(" ")).toContain("8 h");
    expect(f.recuperation.join(" ")).toContain("Demain : Seuil 3 x 10 min. Arrive frais");
    expect(f.recuperation.join(" ")).toContain("Hydratation");
    expect(f.nutrition).toBeNull();
  });

  it("donne la nutrition de récupération à l'offre Premium, à la place de l'hydratation générale", () => {
    const f = redigerFelicitations(seance(), { nutritionApres: ["Protéines dans l'heure : 21 g."] });
    expect(f.nutrition).toEqual(["Protéines dans l'heure : 21 g."]);
    expect(f.recuperation.join(" ")).not.toContain("Hydratation");
  });

  it("reste léger après une séance facile", () => {
    const f = redigerFelicitations(seance({ sport: "natation", titre: "Technique", dureeMin: 40, distanceKm: 1.6 }));
    expect(f.resume[0]).toBe("Technique : 40 min · 1600 m.");
    expect(f.recuperation.join(" ")).toContain("se récupère vite");
  });

  it("salue une séance écourtée sans culpabiliser", () => {
    const f = redigerFelicitations(seance({ dureeReelleMin: 60 }));
    expect(f.resume.join(" ")).toContain("c'est fait quand même");
  });

  it("garde le même message pour une même séance", () => {
    expect(redigerFelicitations(seance()).titre).toBe(redigerFelicitations(seance()).titre);
  });
});

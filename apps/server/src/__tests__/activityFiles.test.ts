import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatFromFilename, parseActivityFile } from "../lib/activityFiles.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const lire = (nom: string) => fs.readFileSync(path.join(fixtures, nom));

describe("reconnaissance du format", () => {
  it("accepte les trois extensions, quelle que soit la casse", () => {
    expect(formatFromFilename("seance.fit")).toBe("fit");
    expect(formatFromFilename("SORTIE.GPX")).toBe("gpx");
    expect(formatFromFilename("Natation.Tcx")).toBe("tcx");
  });

  it("refuse tout le reste", () => {
    expect(formatFromFilename("photo.jpg")).toBeNull();
    expect(formatFromFilename("sansextension")).toBeNull();
  });
});

describe("fichier .fit d'une montre", () => {
  const activite = parseActivityFile(lire("course.fit"), "course.fit");

  it("reconnaît la discipline et la date", () => {
    expect(activite.sport).toBe("course");
    expect(activite.startedAt.toISOString()).toBe("2026-09-09T07:00:00.000Z");
  });

  it("retient le temps en mouvement, pas le temps écoulé", () => {
    // La session déclare 2900 s écoulées mais 2700 s en mouvement.
    expect(activite.dureeMin).toBe(45);
  });

  it("lit la distance et en déduit l'allure", () => {
    expect(activite.distanceKm).toBe(10);
    expect(activite.allureSecParKm).toBe(270); // 4:30/km
  });

  it("moyenne la fréquence cardiaque des points de trace", () => {
    expect(activite.fcMoyenne).toBeGreaterThan(140);
    expect(activite.fcMoyenne).toBeLessThan(152);
    expect(activite.fcMax).toBeGreaterThanOrEqual(activite.fcMoyenne!);
  });

  it("laisse la puissance à null quand elle vaut zéro partout", () => {
    // Une montre de course enregistre 0 W : ce n'est pas une mesure.
    expect(activite.puissanceMoy).toBeNull();
  });
});

describe("fichier .gpx", () => {
  const activite = parseActivityFile(lire("velo.gpx"), "velo.gpx");

  it("reconnaît la discipline depuis le type de trace", () => {
    expect(activite.sport).toBe("velo");
    expect(activite.name).toBe("Sortie vélo matinale");
  });

  it("déduit la durée des horodatages", () => {
    // 08:00 → 08:10
    expect(activite.dureeMin).toBe(10);
  });

  it("calcule la distance à partir des coordonnées", () => {
    // Le GPX ne porte pas de distance : elle vient des positions.
    expect(activite.distanceKm).toBeGreaterThan(3);
    expect(activite.distanceKm).toBeLessThan(6);
  });

  it("lit la fréquence cardiaque dans l'extension Garmin", () => {
    expect(activite.fcMoyenne).toBe(139);
    expect(activite.fcMax).toBe(150);
  });

  it("cumule le dénivelé positif sans compter les descentes", () => {
    // 170 → 185 → 210 → 195 : +40 m de montée.
    expect(activite.denivelePosM).toBe(40);
  });
});

describe("fichier .tcx", () => {
  const activite = parseActivityFile(lire("natation.tcx"), "natation.tcx");

  it("reconnaît la natation et additionne les tours", () => {
    expect(activite.sport).toBe("natation");
    expect(activite.dureeMin).toBe(30); // 900 s + 900 s
    expect(activite.distanceKm).toBe(1.5); // 750 m + 750 m
  });

  it("prend la date de début dans l'identifiant de l'activité", () => {
    expect(activite.startedAt.toISOString()).toBe("2026-09-09T06:30:00.000Z");
  });

  it("moyenne la fréquence cardiaque des points", () => {
    expect(activite.fcMoyenne).toBe(127);
  });
});

describe("identifiant de déduplication", () => {
  it("est identique pour un même fichier réimporté sous un autre nom", () => {
    const a = parseActivityFile(lire("velo.gpx"), "velo.gpx");
    const b = parseActivityFile(lire("velo.gpx"), "copie-du-9-septembre.gpx");
    expect(a.externalId).toBe(b.externalId);
  });

  it("diffère entre deux séances distinctes", () => {
    const course = parseActivityFile(lire("course.fit"), "course.fit");
    const velo = parseActivityFile(lire("velo.gpx"), "velo.gpx");
    expect(course.externalId).not.toBe(velo.externalId);
  });
});

describe("fichiers refusés", () => {
  it("refuse une extension inconnue", () => {
    expect(() => parseActivityFile(Buffer.from("x"), "photo.jpg")).toThrow(/Format non reconnu/);
  });

  it("refuse un fichier vide", () => {
    expect(() => parseActivityFile(Buffer.alloc(0), "vide.fit")).toThrow(/vide/);
  });

  it("refuse un .fit qui n'en est pas un", () => {
    expect(() => parseActivityFile(Buffer.from("ceci n'est pas un fichier fit"), "faux.fit")).toThrow(
      /illisible|décodé/
    );
  });

  it("refuse un XML qui n'est pas un GPX", () => {
    expect(() => parseActivityFile(Buffer.from("<html><body>bonjour</body></html>"), "page.gpx")).toThrow(
      /invalide/
    );
  });

  it("refuse un GPX sans horodatage, dont la durée est incalculable", () => {
    const sansTemps = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>
      <trkpt lat="45.0" lon="4.0"><ele>100</ele></trkpt>
      <trkpt lat="45.1" lon="4.1"><ele>110</ele></trkpt>
    </trkseg></trk></gpx>`;
    expect(() => parseActivityFile(Buffer.from(sansTemps), "sansdate.gpx")).toThrow(/horodatage/);
  });

  it("refuse une séance trop courte pour être un entraînement", () => {
    const court = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>
      <trkpt lat="45.0" lon="4.0"><time>2026-09-09T08:00:00Z</time></trkpt>
      <trkpt lat="45.0" lon="4.0"><time>2026-09-09T08:00:10Z</time></trkpt>
    </trkseg></trk></gpx>`;
    expect(() => parseActivityFile(Buffer.from(court), "court.gpx")).toThrow(/moins de 30 secondes/);
  });
});

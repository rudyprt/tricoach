import { describe, expect, it } from "vitest";
import { localCalendarDate, safeTimeZone, startOfLocalDay, startOfWeek, weekDays } from "../lib/week.js";

describe("startOfWeek", () => {
  it("renvoie le lundi de la semaine en cours", () => {
    // mercredi 9 septembre 2026
    expect(startOfWeek(new Date("2026-09-09T10:00:00Z"), "Europe/Paris").toISOString()).toBe(
      "2026-09-07T00:00:00.000Z"
    );
  });

  it("traite le dimanche comme la fin de la semaine, pas le début", () => {
    expect(startOfWeek(new Date("2026-09-13T10:00:00Z"), "Europe/Paris").toISOString()).toBe(
      "2026-09-07T00:00:00.000Z"
    );
  });

  it("bascule de semaine selon le fuseau de l'athlète, pas celui du serveur", () => {
    // Dimanche 13/09 23h30 UTC : déjà lundi 14 en Nouvelle-Zélande,
    // encore dimanche 13 en Californie.
    const instant = new Date("2026-09-13T23:30:00Z");
    expect(startOfWeek(instant, "Pacific/Auckland").toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(startOfWeek(instant, "America/Los_Angeles").toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  it("retombe sur le fuseau par défaut si celui fourni est inconnu", () => {
    expect(safeTimeZone("Mars/Olympus")).toBe("Europe/Paris");
    expect(() => startOfWeek(new Date(), "Mars/Olympus")).not.toThrow();
  });
});

describe("weekDays", () => {
  it("liste les 7 jours du lundi au dimanche", () => {
    expect(weekDays(new Date("2026-09-07T00:00:00Z"))).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
  });
});

describe("startOfLocalDay", () => {
  it("renvoie minuit dans le fuseau de l'athlète", () => {
    const instant = new Date("2026-09-09T10:00:00Z");
    // Paris est à UTC+2 en septembre : minuit local = 22h UTC la veille.
    expect(startOfLocalDay(instant, "Europe/Paris").toISOString()).toBe("2026-09-08T22:00:00.000Z");
    expect(localCalendarDate(instant, "Europe/Paris")).toBe("2026-09-09");
  });
});

import { describe, expect, it } from "vitest";
import { parseZoneOverrides, zoneOverridesSchema } from "../lib/zoneOverrides.js";

describe("parseZoneOverrides", () => {
  it("accepte une correction bien formée", () => {
    expect(parseZoneOverrides({ course: { Z2: "5:30/km" } })).toEqual({ course: { Z2: "5:30/km" } });
  });

  it("écarte les valeurs vides", () => {
    expect(parseZoneOverrides({ course: { Z2: "  ", Z3: "5:00/km" } })).toEqual({ course: { Z3: "5:00/km" } });
    expect(parseZoneOverrides({ course: { Z2: "" } })).toBeNull();
  });

  it("refuse une zone inconnue ou une valeur démesurée", () => {
    expect(parseZoneOverrides({ course: { Z9: "5:00/km" } })).toBeNull();
    expect(parseZoneOverrides({ course: { Z2: "x".repeat(100) } })).toBeNull();
  });

  it("explique le refus en français", () => {
    const zone = zoneOverridesSchema.safeParse({ course: { Z9: "5:00/km" } });
    expect(zone.success).toBe(false);
    expect(zone.success === false && zone.error.issues[0]?.message).toBe("Zone inconnue : utilisez Z1 à Z5.");

    const valeur = zoneOverridesSchema.safeParse({ course: { Z2: "x".repeat(100) } });
    expect(valeur.success === false && valeur.error.issues[0]?.message).toBe("40 caractères maximum par zone.");
  });

  it("refuse une structure inattendue plutôt que de la propager", () => {
    expect(parseZoneOverrides(null)).toBeNull();
    expect(parseZoneOverrides("5:30/km")).toBeNull();
    expect(parseZoneOverrides({ course: "5:30/km" })).toBeNull();
    expect(parseZoneOverrides({ escalade: { Z2: "dur" } })).toBeNull();
    expect(parseZoneOverrides({ course: { Z2: 330 } })).toBeNull();
  });

  it("conserve les trois sports", () => {
    const parsed = parseZoneOverrides({
      course: { Z2: "5:30/km" },
      natation: { Z4: "1:45/100m" },
      velo: { Z3: "180-200 W" },
    });
    expect(Object.keys(parsed ?? {})).toEqual(["course", "natation", "velo"]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Session } from "../../lib/api";

/**
 * Chaque bloc montre les battements à tenir, à côté de l'allure : c'est ce que
 * l'athlète lit sur sa montre pendant l'effort.
 */

vi.mock("../../lib/api", async () => {
  const reel = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...reel, api: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn(), patch: vi.fn() } };
});

const { SeanceGuidee } = await import("../SeanceGuidee");

const seance = {
  id: "s1",
  date: "2026-10-12T00:00:00.000Z",
  sport: "course",
  titre: "Footing",
  dureeMin: 45,
  description: "",
  objectif: null,
  status: "planifiee",
  structure: {
    echauffement: { dureeMin: 10, cible: "Z1 récupération — 5:45/km", description: "Souple", fc: "126–134 bpm" },
    corps: { dureeMin: 30, cible: "Z2 endurance — 5:15/km", description: "Aisance", fc: "135–149 bpm" },
    retourCalme: { dureeMin: 5, cible: "Z1 récupération — 5:50/km", description: "Calme", fc: "126–134 bpm" },
  },
} as unknown as Session;

describe("fréquence cardiaque en mode guidé", () => {
  it("affiche les battements du bloc en cours, à côté de l'allure", () => {
    render(<SeanceGuidee session={seance} onFermer={vi.fn()} />);
    expect(screen.getByText("Z1 récupération — 5:45/km")).toBeInTheDocument();
    expect(screen.getByText("126–134 bpm")).toBeInTheDocument();
  });
});

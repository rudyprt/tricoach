import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Session } from "../../lib/api";

/**
 * Une séance de renforcement se lit comme une fiche de salle : le nom de
 * chaque exercice, ses séries, sa charge, son repos et le point technique.
 */

vi.mock("../../lib/api", async () => {
  const reel = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...reel, api: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn(), patch: vi.fn() } };
});

const { SeanceGuidee } = await import("../SeanceGuidee");

const seance = {
  id: "s1",
  date: "2026-10-12T00:00:00.000Z",
  sport: "renfo",
  titre: "Force générale",
  dureeMin: 40,
  description: "",
  objectif: null,
  status: "planifiee",
  structure: {
    echauffement: { dureeMin: 8, cible: "RPE 3/10", description: "Mobilité" },
    corps: {
      dureeMin: 27,
      cible: "RPE 7/10",
      description: "Circuit force",
      exercices: [
        { nom: "Fentes bulgares", repetitions: "3 x 10 par jambe", allure: "poids du corps", recuperation: "60 s", consigne: "Genou dans l'axe du pied" },
      ],
    },
    retourCalme: { dureeMin: 5, cible: "RPE 2/10", description: "Étirements" },
  },
} as unknown as Session;

describe("séance de renforcement en mode guidé", () => {
  it("affiche le nom, les séries, le repos et la consigne de chaque exercice", async () => {
    render(<SeanceGuidee session={seance} onFermer={vi.fn()} />);
    // Le corps de séance est le deuxième bloc : on y passe.
    screen.getByRole("button", { name: /Bloc suivant/i }).click();

    expect(await screen.findByText("Fentes bulgares")).toBeInTheDocument();
    expect(screen.getByText("3 x 10 par jambe")).toBeInTheDocument();
    expect(screen.getByText(/repos 60 s/)).toBeInTheDocument();
    expect(screen.getByText("Genou dans l'axe du pied")).toBeInTheDocument();
  });
});

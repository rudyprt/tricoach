import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VueSemaine } from "../VueSemaine";
import type { Session } from "../../lib/api";

function seance(partial: Partial<Session> & { id: string; date: string }): Session {
  return {
    planId: "p1",
    sport: "course",
    titre: "Footing",
    dureeMin: 45,
    distanceKm: null,
    description: "",
    objectif: null,
    structure: null,
    status: "planifiee",
    ressenti: null,
    completedAt: null,
    ...partial,
  } as Session;
}

/**
 * La bande de semaine sert à lire la forme de la semaine d'un coup d'œil : ce
 * qui compte est qu'elle reste navigable au clavier et annoncée correctement.
 */
describe("VueSemaine", () => {
  const semaine = [
    seance({ id: "1", date: "2026-03-02", titre: "Footing", dureeMin: 45 }),
    seance({ id: "2", date: "2026-03-03", sport: "repos", titre: "Repos", dureeMin: 0 }),
    seance({ id: "3", date: "2026-03-04", titre: "Seuil", dureeMin: 75, status: "faite" }),
  ];

  it("rend un bouton par jour, décrit pour un lecteur d'écran", () => {
    render(<VueSemaine sessions={semaine} onSelect={vi.fn()} />);

    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /Seuil, 75 minutes/ })).toBeInTheDocument();
  });

  it("remonte la séance choisie", () => {
    const onSelect = vi.fn();
    render(<VueSemaine sessions={semaine} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /Footing/ }));

    expect(onSelect).toHaveBeenCalledWith("1");
  });

  it("marque la séance ouverte", () => {
    render(<VueSemaine sessions={semaine} selectionId="3" onSelect={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Seuil/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Footing/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("accepte une date ISO complète, telle que l'API la renvoie", () => {
    // `2026-03-02T00:00:00.000Z` concaténé à « T12:00:00 » donnait
    // « Invalid Date » sous les barres.
    const isoComplet = [seance({ id: "9", date: "2026-03-02T00:00:00.000Z", titre: "Footing" })];
    render(<VueSemaine sessions={isoComplet} onSelect={vi.fn()} />);

    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it("ne rend rien sans séance", () => {
    const { container } = render(<VueSemaine sessions={[]} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("trie les jours par date, quel que soit l'ordre reçu", () => {
    const desordre = [semaine[2], semaine[0], semaine[1]];
    render(<VueSemaine sessions={desordre} onSelect={vi.fn()} />);

    const boutons = screen.getAllByRole("button");
    expect(boutons[0]).toHaveAccessibleName(/Footing/);
    expect(boutons[2]).toHaveAccessibleName(/Seuil/);
  });
});

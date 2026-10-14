import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/** Le bravo qui suit une séance faite, avec ses conseils de récupération. */

const get = vi.fn();
vi.mock("../../lib/api", async () => {
  const reel = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...reel, api: { get: (...a: unknown[]) => get(...a) } };
});

const { FelicitationsSeance } = await import("../FelicitationsSeance");

const MESSAGE = {
  titre: "Bravo, sortie vélo validée 🚴",
  resume: ["Sortie longue : 150 min · 62 km."],
  recuperation: ["Sommeil : vise 8 h cette nuit."],
};

function afficher(status = "faite") {
  return render(
    <MemoryRouter>
      <FelicitationsSeance sessionId="s1" status={status} />
    </MemoryRouter>
  );
}

describe("félicitations après une séance", () => {
  afterEach(() => get.mockReset());

  it("donne la nutrition de récupération à l'offre Premium", async () => {
    get.mockResolvedValue({ data: { premium: true, felicitations: { ...MESSAGE, nutrition: ["Protéines dans l'heure : 21 g."] } } });
    afficher();
    expect(await screen.findByText(MESSAGE.titre)).toBeInTheDocument();
    expect(screen.getByText(/Protéines dans l'heure/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "offre Premium" })).not.toBeInTheDocument();
  });

  it("propose la nutrition Premium aux autres offres", async () => {
    get.mockResolvedValue({ data: { premium: false, felicitations: { ...MESSAGE, nutrition: null } } });
    afficher();
    expect(await screen.findByText(/Sommeil : vise 8 h/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "offre Premium" })).toHaveAttribute("href", "/abonnement");
  });

  it("n'apparaît pas tant que la séance n'est pas faite", () => {
    afficher("planifiee");
    expect(get).not.toHaveBeenCalled();
  });
});

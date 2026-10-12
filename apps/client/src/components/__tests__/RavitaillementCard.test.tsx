import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Session } from "../../lib/api";

/**
 * Ravitaillement d'une séance : affiché aux athlètes Premium, avec le journal
 * qui dose les séances suivantes ; présenté aux autres.
 */

const get = vi.fn();
const put = vi.fn();
let premium = true;

vi.mock("../../lib/api", async () => {
  const reel = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...reel, api: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) } };
});
vi.mock("../../lib/AuthContext", () => ({ useAuth: () => ({ user: { isPremium: premium } }) }));

const { RavitaillementCard } = await import("../RavitaillementCard");

const SEANCE = { id: "s1", sport: "velo", titre: "Sortie longue", dureeMin: 180 } as Session;

const RAVITO = {
  avant: ["Repas riche en glucides 3 h avant."],
  pendant: {
    glucidesGH: 70,
    fourchetteGH: [60, 90],
    boissonMlH: 700,
    sodiumMgH: 400,
    exemple: "Par heure : 700 ml de boisson d'effort à 6 % (42 g) + 1 gel (25 g) toutes les 55 min.",
    conseils: ["Commence à t'alimenter dès 20 à 30 min."],
  },
  apres: ["Protéines dans l'heure : 21 g."],
  entrainementDigestif: "Entraînement digestif : à 10 semaine(s) de « Ironman de Nice », vise 70 g/h aujourd'hui.",
  sources: ["Boisson calée sur ta sudation mesurée (1000 ml/h)."],
};

function afficher() {
  return render(
    <MemoryRouter>
      <RavitaillementCard session={SEANCE} />
    </MemoryRouter>
  );
}

describe("ravitaillement d'une séance", () => {
  afterEach(() => {
    get.mockReset();
    put.mockReset();
    premium = true;
  });

  it("affiche les doses avant, pendant et après", async () => {
    get.mockResolvedValue({ data: { ravitaillement: RAVITO, journal: null } });
    afficher();
    expect(await screen.findByText("🍌 Ravitaillement — 70 g de glucides/h")).toBeInTheDocument();
    expect(screen.getByText(RAVITO.pendant.exemple)).toBeInTheDocument();
    expect(screen.getByText(/Ironman de Nice/)).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/nutrition/seance/s1");
  });

  it("note ce que l'athlète a pris et comment il l'a toléré", async () => {
    get.mockResolvedValue({ data: { ravitaillement: RAVITO, journal: null } });
    put.mockResolvedValue({ data: { journal: { glucidesG: 180, boissonMl: 2000, tolerance: "gene", note: "" } } });
    afficher();

    fireEvent.change(await screen.findByLabelText("Glucides au total (g)"), { target: { value: "180" } });
    fireEvent.change(screen.getByLabelText("Boisson au total (ml)"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Un peu gêné" }));
    fireEvent.click(screen.getByRole("button", { name: "Noter" }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0]).toEqual([
      "/nutrition/seance/s1/journal",
      { glucidesG: 180, boissonMl: 2000, tolerance: "gene", note: "" },
    ]);
    expect(await screen.findByText(/les doses de vos prochaines séances en tiennent compte/)).toBeInTheDocument();
  });

  it("présente l'offre aux athlètes qui ne sont pas Premium", () => {
    premium = false;
    afficher();
    expect(screen.getByRole("link", { name: "Offre Premium" })).toHaveAttribute("href", "/abonnement");
    expect(get).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/** Page Nutrition : préférences et test de sudation. */

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();

vi.mock("../../lib/api", async () => {
  const reel = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...reel,
    api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: (...a: unknown[]) => put(...a), delete: vi.fn() },
  };
});
vi.mock("../../lib/AuthContext", () => ({ useAuth: () => ({ user: { isPremium: true } }) }));

const { Nutrition } = await import("../Nutrition");

const VIDE = {
  profil: { poidsKg: null, formats: [], cafeine: false, sueurSalee: false },
  tests: [],
  sudation: { course: null, velo: null, natation: null, global: null },
  toleranceGH: 55,
  limiteGH: null,
};

describe("page Nutrition", () => {
  it("enregistre un test de sudation et en donne le résultat", async () => {
    get.mockResolvedValue({ data: VIDE });
    post.mockResolvedValue({ data: { tauxMlH: 1200 } });
    render(
      <MemoryRouter>
        <Nutrition />
      </MemoryRouter>
    );

    expect(await screen.findByText("55 g/h")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Poids avant (kg)"), { target: { value: "72" } });
    fireEvent.change(screen.getByLabelText("Poids après (kg)"), { target: { value: "71,2" } });
    fireEvent.change(screen.getByLabelText("Boisson bue (ml)"), { target: { value: "400" } });
    fireEvent.click(screen.getByRole("button", { name: "Calculer ma sudation" }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({ sport: "velo", dureeMin: 60, poidsAvantKg: 72, poidsApresKg: 71.2, boissonMl: 400 });
    expect(await screen.findByText(/environ 1200 ml de sueur par heure/)).toBeInTheDocument();
  });

  it("enregistre poids et formats préférés", async () => {
    get.mockResolvedValue({ data: VIDE });
    put.mockResolvedValue({ data: {} });
    render(
      <MemoryRouter>
        <Nutrition />
      </MemoryRouter>
    );

    fireEvent.change(await screen.findByLabelText(/Poids \(kg\)/), { target: { value: "68" } });
    fireEvent.click(screen.getByRole("button", { name: "Gels" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0]).toEqual(["/nutrition/profil", { poidsKg: 68, formats: ["gel"], cafeine: false, sueurSalee: false }]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Retrait du consentement santé depuis « Mon compte » : il demande une
 * confirmation, puis efface les données côté serveur.
 */

const get = vi.fn();
const del = vi.fn();
vi.mock("../../lib/api", async () => {
  const reel = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...reel, api: { get: (...a: unknown[]) => get(...a), delete: (...a: unknown[]) => del(...a) } };
});

const { DonneesSanteCard } = await import("../DonneesSanteCard");

describe("données de santé dans Mon compte", () => {
  afterEach(() => {
    get.mockReset();
    del.mockReset();
  });

  it("retire le consentement après confirmation", async () => {
    get.mockResolvedValue({ data: { consenti: true, depuis: "2026-09-01T10:00:00.000Z" } });
    del.mockResolvedValue({ data: { consenti: false, depuis: null, retireLe: "2026-10-17T09:00:00.000Z" } });
    render(<DonneesSanteCard />);

    fireEvent.click(await screen.findByRole("button", { name: "Retirer mon consentement" }));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Retirer et effacer/ }));

    await waitFor(() => expect(del).toHaveBeenCalledWith("/privacy/sante"));
    expect(await screen.findByRole("status")).toHaveTextContent("données de santé et l'historique du chat ont été effacés");
    expect(screen.queryByRole("button", { name: "Retirer mon consentement" })).toBeNull();
    expect(screen.getByText(/Consentement retiré le/)).toBeInTheDocument();
  });

  it("dit qu'aucune donnée de santé n'est enregistrée sans consentement", async () => {
    get.mockResolvedValue({ data: { consenti: false, depuis: null } });
    render(<DonneesSanteCard />);
    expect(await screen.findByText(/aucune donnée de santé n'est enregistrée/)).toBeInTheDocument();
  });
});

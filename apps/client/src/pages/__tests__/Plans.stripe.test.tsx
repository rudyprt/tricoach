import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Page des offres : les comptes testeurs paient via Stripe (mode test) après
 * deux accords ; les autres gardent exactement l'écran qu'ils connaissent.
 */

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock("../../lib/api", async () => {
  const reel = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...reel,
    api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a) },
  };
});
vi.mock("../../lib/AuthContext", () => ({
  useAuth: () => ({
    user: { plan: "free", isTrialActive: true, trialEndsAt: new Date(Date.now() + 5 * 86400000).toISOString(), selfServeBilling: false },
    refresh: vi.fn(),
  }),
}));

const { Plans } = await import("../Plans");

function afficher() {
  return render(
    <MemoryRouter initialEntries={["/abonnement"]}>
      <Plans />
    </MemoryRouter>
  );
}

describe("paiement des offres", () => {
  afterEach(() => {
    get.mockReset();
    post.mockReset();
    patch.mockReset();
  });

  it("fait payer un testeur via Stripe, après les deux accords", async () => {
    get.mockResolvedValue({ data: { disponible: true, mode: "test", tarifs: { standard: 1999, premium: 3490 }, abonnement: null } });
    post.mockResolvedValue({ data: { url: "https://checkout.stripe.com/c/pay/cs_test_1" } });
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, assign }, writable: true });
    afficher();

    expect(await screen.findByText(/Paiement en mode test/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choisir Premium" }));
    const payer = screen.getByRole("button", { name: /Payer 34,90 € \(test\)/ });
    expect(payer).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/J'accepte les/));
    fireEvent.click(screen.getByLabelText(/Je demande l'accès immédiat/));
    fireEvent.click(payer);

    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_1"));
    expect(post).toHaveBeenCalledWith("/billing/checkout", { plan: "premium", conditions: true, accesImmediat: true });
    expect(patch).not.toHaveBeenCalled();
  });

  it("ne change rien pour les autres comptes", async () => {
    get.mockResolvedValue({ data: { disponible: false, mode: "test", tarifs: { standard: 1999, premium: 3490 }, abonnement: null } });
    patch.mockRejectedValue({ isAxiosError: true, response: { status: 402, data: { error: "Le paiement en ligne n'est pas encore disponible.", code: "BILLING_UNAVAILABLE" } } });
    afficher();

    await waitFor(() => expect(get).toHaveBeenCalledWith("/billing"));
    expect(screen.queryByText(/Paiement en mode test/)).not.toBeInTheDocument();
    expect(screen.getByText(/Le paiement en ligne arrive bientôt/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choisir Premium" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith("/auth/plan", { plan: "premium" }));
    expect(post).not.toHaveBeenCalled();
  });

  it("montre l'abonnement en cours et permet de le résilier", async () => {
    get.mockResolvedValue({
      data: {
        disponible: true,
        mode: "test",
        tarifs: { standard: 1999, premium: 3490 },
        abonnement: { statut: "active", plan: "premium", finPeriode: "2026-11-16T10:00:00.000Z", annulationPrevue: false },
      },
    });
    post.mockResolvedValue({ data: { ok: true } });
    afficher();

    expect(await screen.findByText(/Renouvelé automatiquement le 16 novembre 2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Résilier mon abonnement" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/billing/resilier"));
  });
});

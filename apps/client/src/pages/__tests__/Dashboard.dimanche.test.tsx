import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Le dimanche soir, le rappel invite à préparer la semaine. L'écran doit le
 * permettre : jusqu'ici, il ne proposait que de régénérer la semaine qui
 * s'achève, et la nouvelle restait introuvable jusqu'au lundi.
 */

const get = vi.fn();

vi.mock("../../lib/api", async () => {
  const reel = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...reel, api: { get: (...args: unknown[]) => get(...args), post: vi.fn(), patch: vi.fn() } };
});
vi.mock("../../lib/AuthContext", () => ({
  useAuth: () => ({ user: { plan: "premium", hasStandardAccess: true, isPremium: false, isTrialActive: false } }),
}));
vi.mock("../../ui/Toasts", () => ({ useToasts: () => ({ afficher: vi.fn() }) }));
vi.mock("../../ui/Confirmation", () => ({ useConfirmation: () => ({ demander: vi.fn() }) }));
vi.mock("../../components/InstallerApp", () => ({ InstallerApp: () => null }));
vi.mock("../../components/ActionsSemaine", () => ({ ActionsSemaine: () => null }));

const { Dashboard } = await import("../Dashboard");

const PLAN = {
  id: "p1",
  userId: "u1",
  weekStart: "2026-10-05T00:00:00.000Z",
  generatedAt: "2026-10-05T00:00:00.000Z",
  debrief: null,
  phase: "base",
  periodization: { phase: "base", label: "Fondation aérobie", weeksToGoal: 30, volumeFactor: 1, guidance: "" },
  sessions: [],
};

function repondre(suivante: unknown) {
  get.mockImplementation((url: string, config?: { params?: { semaine?: string } }) => {
    if (url === "/plans/current") return Promise.resolve({ data: config?.params?.semaine === "suivante" ? suivante : PLAN });
    if (url === "/plans/previous") return Promise.resolve({ data: { exists: true } });
    return Promise.resolve({ data: null });
  });
}

function afficherLe(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
}

describe("tableau de bord, le dimanche", () => {
  afterEach(() => {
    vi.useRealTimers();
    get.mockReset();
    localStorage.clear();
  });

  it("propose de préparer la semaine prochaine", async () => {
    repondre(null);
    afficherLe("2026-10-11T18:00:00");
    expect(await screen.findByRole("button", { name: "Préparer la semaine prochaine" })).toBeInTheDocument();
  });

  it("mène à la semaine prochaine quand elle est déjà prête", async () => {
    repondre({ ...PLAN, id: "p2", weekStart: "2026-10-12T00:00:00.000Z" });
    afficherLe("2026-10-11T18:00:00");
    expect(await screen.findByRole("button", { name: "Voir la semaine prochaine" })).toBeInTheDocument();
  });

  it("garde la semaine prochaine affichée après avoir quitté l'écran", async () => {
    repondre({ ...PLAN, id: "p2", weekStart: "2026-10-12T00:00:00.000Z" });
    const premier = afficherLe("2026-10-11T18:00:00");
    fireEvent.click(await screen.findByRole("button", { name: "Voir la semaine prochaine" }));
    expect(await screen.findByText("Semaine prochaine")).toBeInTheDocument();
    premier.unmount();

    // Retour sur l'écran : la semaine choisie est toujours là.
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );
    expect(await screen.findByText("Semaine prochaine")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← Revenir à cette semaine" })).toBeInTheDocument();
  });

  it("oublie ce choix le lundi, quand la semaine visée devient la semaine en cours", async () => {
    localStorage.setItem("tricoach.semaine-affichee", "2026-10-12");
    repondre(null);
    afficherLe("2026-10-12T09:00:00");
    await screen.findByText(/Fondation aérobie/);
    expect(screen.queryByText("Semaine prochaine")).not.toBeInTheDocument();
  });

  it("ne dit rien les autres jours", async () => {
    repondre(null);
    afficherLe("2026-10-08T18:00:00");
    await screen.findByText(/Fondation aérobie/);
    expect(screen.queryByText(/semaine prochaine/i)).not.toBeInTheDocument();
  });
});

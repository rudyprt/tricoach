import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * À côté de chaque chrono, l'athlète peut donner la FC moyenne et la FC max
 * relevées sur cette course : le serveur en tire son seuil cardiaque.
 */

const put = vi.fn().mockResolvedValue({ data: {} });

vi.mock("../../lib/api", async () => {
  const reel = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...reel, api: { put: (...args: unknown[]) => put(...args), get: vi.fn() } };
});
vi.mock("../../lib/AuthContext", () => ({ useAuth: () => ({ refresh: vi.fn() }) }));

const { Onboarding } = await import("../Onboarding");

describe("inscription, temps de référence", () => {
  it("envoie la FC moyenne et la FC max de la course saisie", async () => {
    const { container } = render(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByPlaceholderText(/Half Ironman de Nice/), { target: { value: "Triathlon M" } });
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: "2027-06-01" } });
    fireEvent.change(screen.getByPlaceholderText("Ex : 10km en 45min"), { target: { value: "10km en 45min" } });
    fireEvent.change(screen.getByLabelText("FC moyenne — Course à pied"), { target: { value: "172" } });
    fireEvent.change(screen.getByLabelText("FC max — Course à pied"), { target: { value: "186" } });
    fireEvent.click(screen.getByRole("button", { name: "Générer mon programme" }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][1]).toMatchObject({
      tempsCourse: "10km en 45min",
      fcMoyCourse: 172,
      fcMaxCourse: 186,
      // Laissées vides : rien n'est inventé.
      fcMoyVelo: null,
      fcMaxNatation: null,
    });
  });
});

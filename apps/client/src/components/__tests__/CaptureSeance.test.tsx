import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "../../lib/api";

/**
 * Capture d'écran d'une séance : les valeurs lues sont montrées à l'athlète,
 * qui les corrige avant de valider.
 */

const post = vi.fn();
vi.mock("../../lib/api", async () => {
  const reel = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...reel, api: { post: (...a: unknown[]) => post(...a) } };
});

const { CaptureSeance } = await import("../CaptureSeance");

const SEANCE = { id: "s1", sport: "course", titre: "Footing", dureeMin: 60 } as Session;

describe("capture d'écran de séance", () => {
  afterEach(() => post.mockReset());

  it("montre les valeurs lues, laisse les corriger, puis valide", async () => {
    post
      .mockResolvedValueOnce({
        data: {
          mesures: { dureeMin: 52, distanceKm: 10.2, allureSecParKm: 307, fcMoyenne: 148, fcMax: 171, puissanceMoy: null, denivelePosM: null },
          avertissements: ["Valeur de FC max coupée sur la capture."],
        },
      })
      .mockResolvedValueOnce({ data: { bilan: { niveau: "ecart", constats: [], proposerReajustement: false } } });
    const onValidee = vi.fn();
    const { container } = render(<CaptureSeance session={SEANCE} onValidee={onValidee} />);

    const fichier = new File(["png"], "strava.png", { type: "image/png" });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [fichier] } });

    expect(await screen.findByDisplayValue("52")).toBeInTheDocument();
    expect(screen.getByDisplayValue("5:07")).toBeInTheDocument();
    expect(screen.getByText("Valeur de FC max coupée sur la capture.")).toBeInTheDocument();
    expect(post.mock.calls[0][0]).toBe("/sessions/s1/capture");
    expect((post.mock.calls[0][1] as FormData).getAll("captures")).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Durée (min)"), { target: { value: "55" } });
    fireEvent.click(screen.getByRole("button", { name: "Valider la séance" }));

    await waitFor(() => expect(onValidee).toHaveBeenCalled());
    expect(post.mock.calls[1]).toEqual([
      "/sessions/s1/capture/valider",
      { dureeMin: 55, distanceKm: 10.2, fcMoyenne: 148, fcMax: 171, puissanceMoy: null, denivelePosM: null, allureSecParKm: 307 },
    ]);
    expect(onValidee.mock.calls[0][1]).toBe(55);
  });

  it("dit pourquoi une capture n'a pas pu être lue", async () => {
    post.mockRejectedValueOnce({ isAxiosError: true, response: { data: { error: "Sur iPhone, une capture d'écran convient ; une photo HEIC, non." } } });
    const { container } = render(<CaptureSeance session={SEANCE} onValidee={vi.fn()} />);
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(["x"], "photo.heic", { type: "image/heic" })] },
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Ce que le coach a retenu s'applique à chaque semaine : l'athlète doit le
 * voir, et pouvoir effacer une consigne mal comprise.
 */

const get = vi.fn();
const del = vi.fn().mockResolvedValue({});

vi.mock("../../lib/api", async () => {
  const reel = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...reel, api: { get: (...a: unknown[]) => get(...a), delete: (...a: unknown[]) => del(...a) } };
});

const { ConsignesCoach } = await import("../ConsignesCoach");

describe("ConsignesCoach", () => {
  it("n'affiche rien tant que le coach n'a rien retenu", async () => {
    get.mockResolvedValueOnce({ data: { consignes: [] } });
    const { container } = render(<ConsignesCoach version={0} />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("liste les consignes et en efface une", async () => {
    get.mockResolvedValueOnce({
      data: { consignes: [{ id: "c1", texte: "Placer le renforcement le lundi.", jusquAu: null }] },
    });
    render(<ConsignesCoach version={0} />);

    fireEvent.click(await screen.findByRole("button", { name: /Ce que votre coach a retenu \(1\)/ }));
    expect(screen.getByText("Placer le renforcement le lundi.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Retirer la consigne/ }));
    await waitFor(() => expect(screen.queryByText("Placer le renforcement le lundi.")).not.toBeInTheDocument());
    expect(del).toHaveBeenCalledWith("/consignes/c1");
  });
});

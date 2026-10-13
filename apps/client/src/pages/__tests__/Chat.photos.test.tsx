import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/** Photos jointes au message du coach : aperçu, retrait, envoi en multipart. */

const get = vi.fn();
const post = vi.fn();
vi.mock("../../lib/api", async () => {
  const reel = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...reel, api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), delete: vi.fn() } };
});
vi.mock("../../lib/AuthContext", () => ({ useAuth: () => ({ user: { isPremium: false } }) }));
vi.mock("../../ui/Confirmation", () => ({ useConfirmation: () => ({ demander: vi.fn() }) }));
vi.mock("../../components/ConsignesCoach", () => ({ ConsignesCoach: () => null }));

const { Chat } = await import("../Chat");

beforeAll(() => {
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:apercu-${n++}`);
  Element.prototype.scrollIntoView = vi.fn();
});

describe("photos dans le chat", () => {
  it("joint des photos au message et les envoie au coach", async () => {
    get.mockResolvedValue({ data: { messages: [], quota: { utilises: 0, limite: 10, bloque: null } } });
    post.mockResolvedValue({
      data: { id: "r1", role: "assistant", content: "Belle position.", createdAt: new Date().toISOString() },
    });
    const { container } = render(
      <MemoryRouter>
        <Chat />
      </MemoryRouter>
    );
    await waitFor(() => expect(get).toHaveBeenCalled());

    const choix = container.querySelector('input[type="file"]')!;
    fireEvent.change(choix, { target: { files: [new File(["a"], "velo.png", { type: "image/png" }), new File(["b"], "dos.png", { type: "image/png" })] } });
    expect(screen.getAllByAltText("Photo à envoyer")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Retirer la photo" })[1]);
    expect(screen.getAllByAltText("Photo à envoyer")).toHaveLength(1);

    fireEvent.change(screen.getByPlaceholderText("Écrivez votre message..."), { target: { value: "Ma position ?" } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));

    expect(await screen.findByText("Belle position.")).toBeInTheDocument();
    const [url, corps] = post.mock.calls[0];
    expect(url).toBe("/chat");
    expect(corps).toBeInstanceOf(FormData);
    expect((corps as FormData).get("content")).toBe("Ma position ?");
    expect((corps as FormData).getAll("photos")).toHaveLength(1);
    // L'aperçu reste affiché dans le message envoyé.
    expect(screen.getByAltText("Photo envoyée au coach")).toBeInTheDocument();
  });

  it("envoie un message sans photo en JSON, comme avant", async () => {
    get.mockResolvedValue({ data: { messages: [], quota: { utilises: 0, limite: 10, bloque: null } } });
    post.mockResolvedValue({ data: { id: "r2", role: "assistant", content: "Ok.", createdAt: new Date().toISOString() } });
    render(
      <MemoryRouter>
        <Chat />
      </MemoryRouter>
    );
    fireEvent.change(await screen.findByPlaceholderText("Écrivez votre message..."), { target: { value: "Bonjour" } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/chat", { content: "Bonjour" }));
  });
});

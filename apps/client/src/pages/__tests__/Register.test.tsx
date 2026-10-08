import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";

/**
 * Le piège de l'inscription.
 *
 * L'hébergement gratuit endort le serveur après quinze minutes sans visite.
 * La requête d'inscription peut alors mettre près d'une minute, pendant
 * laquelle l'interface ne montre qu'un cercle qui tourne. Deux testeurs ont
 * cru à un blocage, ont recommencé — et se sont vu répondre que leur adresse
 * était déjà prise. Par leur propre compte, créé à la première tentative.
 *
 * La réponse de l'application est de tenter la connexion avec ce qui vient
 * d'être saisi : si le mot de passe correspond, c'est bien son compte.
 */

const post = vi.fn();
const refresh = vi.fn().mockResolvedValue(undefined);
const navigate = vi.fn();

vi.mock("../../lib/api", async () => {
  const reel = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...reel,
    api: { post: (...args: unknown[]) => post(...args) },
    browserTimeZone: () => "Europe/Paris",
  };
});

vi.mock("../../lib/AuthContext", () => ({ useAuth: () => ({ refresh }) }));

vi.mock("react-router-dom", async () => {
  const reel = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...reel, useNavigate: () => navigate };
});

const { Register } = await import("../Register");

/** Une erreur axios telle que l'intercepteur la remonte réellement. */
function erreurHttp(status: number, message: string): AxiosError {
  const erreur = new AxiosError(message);
  erreur.response = {
    status,
    statusText: "",
    data: { error: message },
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return erreur;
}

function remplirEtEnvoyer() {
  fireEvent.change(screen.getByPlaceholderText(/pr[ée]nom|nom/i), { target: { value: "Eric" } });
  fireEvent.change(screen.getByPlaceholderText(/@/), { target: { value: "eric@example.com" } });
  fireEvent.change(screen.getByPlaceholderText(/caract[èe]res|mot de passe/i), {
    target: { value: "motdepasse123" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /cr[ée]er mon compte/i }));
}

describe("inscription avec une adresse déjà prise", () => {
  beforeEach(() => {
    post.mockReset();
    refresh.mockClear();
    navigate.mockClear();
  });

  it("connecte l'athlète quand le mot de passe est le sien", async () => {
    post
      .mockRejectedValueOnce(erreurHttp(409, "Un compte existe déjà avec cet e-mail."))
      .mockResolvedValueOnce({ data: {} });

    render(
      <MemoryRouter>
        <Register />
      </MemoryRouter>
    );
    remplirEtEnvoyer();

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/plans-intro"));
    expect(post.mock.calls[1][0]).toBe("/auth/login");
    // Aucun message d'erreur : pour l'athlète, l'inscription a simplement abouti.
    expect(screen.queryByText(/existe d[ée]j[àa]/i)).not.toBeInTheDocument();
  });

  it("propose de se connecter ou de réinitialiser quand ce n'est pas son compte", async () => {
    post
      .mockRejectedValueOnce(erreurHttp(409, "Un compte existe déjà avec cet e-mail."))
      .mockRejectedValueOnce(erreurHttp(401, "Identifiants invalides."));

    render(
      <MemoryRouter>
        <Register />
      </MemoryRouter>
    );
    remplirEtEnvoyer();

    // Dans le bandeau d'erreur lui-même : la page porte déjà un lien « Se
    // connecter » en pied, qui ne répond pas à la question posée ici.
    const bandeau = await screen.findByRole("alert");
    expect(within(bandeau).getByText(/existe d[ée]j[àa]/i)).toBeInTheDocument();
    expect(within(bandeau).getByRole("link", { name: /se connecter/i })).toBeInTheDocument();
    expect(within(bandeau).getByRole("link", { name: /mot de passe oubli[ée]/i })).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("ne tente pas de connexion sur une autre erreur", async () => {
    post.mockRejectedValueOnce(erreurHttp(400, "8 caractères minimum"));

    render(
      <MemoryRouter>
        <Register />
      </MemoryRouter>
    );
    remplirEtEnvoyer();

    await waitFor(() => expect(screen.getByText(/8 caract[èe]res/i)).toBeInTheDocument());
    expect(post).toHaveBeenCalledTimes(1);
  });
});

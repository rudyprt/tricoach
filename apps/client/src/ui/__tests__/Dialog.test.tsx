import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Dialog } from "../Dialog";

/**
 * Les anciennes modales n'avaient ni rôle, ni fermeture au clavier, ni piège à
 * focus. Ces tests portent exactement sur ce qui manquait.
 */
describe("Dialog", () => {
  it("s'annonce comme une boîte de dialogue nommée", () => {
    render(
      <Dialog ouvert onClose={vi.fn()} titre="Régénérer la semaine ?" description="Les séances seront remplacées.">
        <p>Contenu</p>
      </Dialog>
    );

    const boite = screen.getByRole("dialog");
    expect(boite).toHaveAttribute("aria-modal", "true");
    expect(boite).toHaveAccessibleName("Régénérer la semaine ?");
    expect(boite).toHaveAccessibleDescription("Les séances seront remplacées.");
  });

  it("se ferme avec la touche Échap", () => {
    const onClose = vi.fn();
    render(
      <Dialog ouvert onClose={onClose} titre="Titre">
        <p>Contenu</p>
      </Dialog>
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("ne se ferme pas pendant une action en cours", () => {
    const onClose = vi.fn();
    render(
      <Dialog ouvert onClose={onClose} titre="Titre" bloquant>
        <p>Contenu</p>
      </Dialog>
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    // Le bouton de fermeture disparaît aussi : rien ne doit interrompre.
    expect(screen.queryByRole("button", { name: "Fermer" })).not.toBeInTheDocument();
  });

  it("place le focus sur la boîte, pour qu'elle soit annoncée", () => {
    render(
      <Dialog ouvert onClose={vi.fn()} titre="Titre" description="Description">
        <button>Première action</button>
      </Dialog>
    );

    // Et non sur le premier bouton, qui serait « Fermer » et ne dirait rien de
    // ce que l'on vient d'ouvrir.
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("fait boucler la tabulation à l'intérieur", () => {
    render(
      <Dialog ouvert onClose={vi.fn()} titre="Titre">
        <button>Action</button>
      </Dialog>
    );

    const cibles = screen.getAllByRole("button");
    const dernier = cibles[cibles.length - 1];
    dernier.focus();
    fireEvent.keyDown(document, { key: "Tab" });

    // Sans piège à focus, la tabulation partait visiter l'arrière-plan que
    // l'utilisateur ne voit pas.
    expect(document.activeElement).toBe(cibles[0]);
  });

  it("empêche le fond de défiler", () => {
    const { unmount } = render(
      <Dialog ouvert onClose={vi.fn()} titre="Titre">
        <p>Contenu</p>
      </Dialog>
    );

    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("ne rend rien quand elle est fermée", () => {
    render(
      <Dialog ouvert={false} onClose={vi.fn()} titre="Titre">
        <p>Contenu</p>
      </Dialog>
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

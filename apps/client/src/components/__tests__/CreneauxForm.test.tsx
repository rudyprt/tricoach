import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CreneauxForm } from "../CreneauxForm";
import type { Disponibilites } from "../../lib/api";

/**
 * Les créneaux sont des bornes, pas des préférences : une erreur ici produit
 * un programme que l'athlète ne peut pas suivre.
 */
describe("CreneauxForm", () => {
  const semaine: Disponibilites = {
    lundi: { disponible: true, dureeMaxMin: 60, moment: "soir" },
    mardi: { disponible: false },
  };

  it("affiche les sept jours", () => {
    render(<CreneauxForm valeur={semaine} onChange={vi.fn()} />);
    for (const jour of ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]) {
      expect(screen.getByText(jour)).toBeInTheDocument();
    }
  });

  it("marque un jour indisponible comme repos imposé", () => {
    render(<CreneauxForm valeur={semaine} onChange={vi.fn()} />);
    expect(screen.getByText("Repos imposé")).toBeInTheDocument();
  });

  it("annonce le volume total, qui plafonne le programme", () => {
    const pleine: Disponibilites = {
      lundi: { disponible: true, dureeMaxMin: 60 },
      samedi: { disponible: true, dureeMaxMin: 180 },
    };
    render(<CreneauxForm valeur={pleine} onChange={vi.fn()} />);
    expect(screen.getByText(/4 h par semaine/)).toBeInTheDocument();
  });

  it("bascule la disponibilité d'un jour sans toucher aux autres", () => {
    const onChange = vi.fn();
    render(<CreneauxForm valeur={semaine} onChange={onChange} />);

    // Le premier interrupteur est celui de lundi.
    fireEvent.click(screen.getAllByRole("button", { pressed: true })[0]);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        lundi: expect.objectContaining({ disponible: false, dureeMaxMin: 60 }),
        mardi: { disponible: false },
      })
    );
  });

  it("enregistre une durée choisie", () => {
    const onChange = vi.fn();
    render(<CreneauxForm valeur={semaine} onChange={onChange} />);

    const durees = screen.getAllByRole("combobox");
    fireEvent.change(durees[0], { target: { value: "90" } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ lundi: expect.objectContaining({ dureeMaxMin: 90 }) })
    );
  });

  it("traite « durée libre » comme une absence de limite, pas comme zéro", () => {
    const onChange = vi.fn();
    render(<CreneauxForm valeur={semaine} onChange={onChange} />);

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ lundi: expect.objectContaining({ dureeMaxMin: null }) })
    );
  });

  it("considère un jour non renseigné comme disponible", () => {
    // Un athlète qui n'a rien touché ne doit pas se retrouver avec une semaine
    // entièrement en repos.
    render(<CreneauxForm valeur={{}} onChange={vi.fn()} />);
    expect(screen.queryByText("Repos imposé")).not.toBeInTheDocument();
  });
});

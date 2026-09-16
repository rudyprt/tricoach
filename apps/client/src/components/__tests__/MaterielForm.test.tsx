import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MaterielForm, MATERIEL_PAR_DEFAUT } from "../MaterielForm";

/**
 * Le matériel décide de ce que le coach a le droit de prescrire : sans bassin,
 * plus de natation ; sans capteur, plus de watts.
 */
describe("MaterielForm", () => {
  it("propose l'absence d'accès à un bassin", () => {
    render(<MaterielForm valeur={MATERIEL_PAR_DEFAUT} onChange={vi.fn()} />);
    expect(screen.getByRole("option", { name: "Aucun accès" })).toBeInTheDocument();
  });

  it("remonte le changement de bassin", () => {
    const onChange = vi.fn();
    render(<MaterielForm valeur={MATERIEL_PAR_DEFAUT} onChange={onChange} />);

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "aucune" } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ piscine: "aucune" }));
  });

  it("bascule un équipement sans effacer les autres", () => {
    const onChange = vi.fn();
    render(<MaterielForm valeur={MATERIEL_PAR_DEFAUT} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Home-trainer" }));

    expect(onChange).toHaveBeenCalledWith({ ...MATERIEL_PAR_DEFAUT, homeTrainer: true });
  });

  it("reflète l'état de chaque équipement", () => {
    render(<MaterielForm valeur={{ ...MATERIEL_PAR_DEFAUT, capteurPuissance: true }} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Capteur de puissance" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Tapis de course" })).toHaveAttribute("aria-pressed", "false");
  });
});

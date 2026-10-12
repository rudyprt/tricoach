import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BilanSeance } from "../BilanSeance";

/**
 * Le bilan dit l'écart entre la séance faite et la séance prévue. Il ne
 * propose de réajuster la semaine que lorsque l'écart est important.
 */
describe("BilanSeance", () => {
  it("affiche les constats sans proposer de réajuster une séance conforme", () => {
    render(
      <MemoryRouter>
        <BilanSeance
          bilan={{
            niveau: "conforme",
            constats: [{ niveau: "conforme", texte: "FC moyenne 140 bpm, dans la cible (128–147 bpm)." }],
            proposerReajustement: false,
          }}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("FC moyenne 140 bpm, dans la cible (128–147 bpm).")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Réajuster ma semaine" })).not.toBeInTheDocument();
  });

  it("propose de réajuster la semaine sur un écart important", () => {
    render(
      <MemoryRouter>
        <BilanSeance
          bilan={{
            niveau: "alerte",
            constats: [{ niveau: "alerte", texte: "Séance écourtée : 30 min sur 60 prévues." }],
            proposerReajustement: true,
          }}
        />
      </MemoryRouter>
    );
    expect(screen.getByText(/Écart important avec le programme/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Réajuster ma semaine" })).toHaveAttribute("href", "/dashboard?reajuster=1");
  });
});

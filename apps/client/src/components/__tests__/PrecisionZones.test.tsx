import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PrecisionZone } from "../../lib/api";

/**
 * Des zones estimées doivent se lire comme telles, avec le moyen de les
 * mesurer : un test de terrain dans la discipline concernée.
 */

const post = vi.fn().mockResolvedValue({ data: {} });
vi.mock("../../lib/api", async () => {
  const reel = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...reel, api: { post: (...a: unknown[]) => post(...a) } };
});

const { PrecisionZones } = await import("../PrecisionZones");

const PRECISION: PrecisionZone[] = [
  { discipline: "course", niveau: "estimee", source: "Estimées depuis votre chrono « 10km en 44min ».", test: "course", aRefaire: false },
  { discipline: "velo", niveau: "mesuree", source: "Mesurées par votre test FTP du 2 septembre.", test: "velo", aRefaire: false },
  { discipline: "natation", niveau: "mesuree", source: "Mesurées par votre test CSS du 1er mai.", test: "natation", aRefaire: true },
  { discipline: "frequenceCardiaque", niveau: "estimee", source: "FC au seuil estimée à 92 % de votre FC max.", test: "course", aRefaire: false },
];

describe("PrecisionZones", () => {
  it("dit d'où vient chaque jeu de zones", () => {
    render(<PrecisionZones precision={PRECISION} onTestDemande={vi.fn()} />);
    expect(screen.getAllByText("Estimées")).toHaveLength(2);
    expect(screen.getByText("Mesurées")).toBeInTheDocument();
    expect(screen.getByText("À refaire")).toBeInTheDocument();
  });

  it("propose le test qui améliore une zone, une seule fois par test", () => {
    render(<PrecisionZones precision={PRECISION} onTestDemande={vi.fn()} />);
    // La course et la FC se mesurent par le même test : un seul bouton.
    expect(screen.getAllByRole("button", { name: "Faire le test de 30 min" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Faire le test CSS" })).toBeInTheDocument();
    // Des zones vélo mesurées et récentes n'appellent aucun test.
    expect(screen.queryByRole("button", { name: "Faire le test FTP" })).not.toBeInTheDocument();
  });

  it("programme le test demandé", async () => {
    const onTestDemande = vi.fn();
    render(<PrecisionZones precision={PRECISION} onTestDemande={onTestDemande} />);
    fireEvent.click(screen.getByRole("button", { name: "Faire le test de 30 min" }));
    await waitFor(() => expect(onTestDemande).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith("/tests/demander", { sport: "course" });
  });
});

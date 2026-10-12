import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Course } from "../../lib/api";

/**
 * Analyse de course : l'athlète Premium saisit ses temps et lit le débrief du
 * coach ; les autres découvrent ce que l'offre apporte.
 */

const get = vi.fn();
const post = vi.fn();
let premium = true;

vi.mock("../../lib/api", async () => {
  const reel = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...reel, api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } };
});
vi.mock("../../lib/AuthContext", () => ({ useAuth: () => ({ user: { isPremium: premium } }) }));

const { AnalyseCourseCard } = await import("../AnalyseCourseCard");

const COURSE: Course = {
  id: "c1",
  nom: "Triathlon de Paris",
  date: "2026-10-04",
  format: "olympique",
  priorite: "A",
  lieu: "",
  objectifTemps: "2h30",
  formatLabel: "Olympique",
  prioriteLabel: "A",
};

const ANALYSE = {
  resume: "Vélo trop rapide, course à pied subie.",
  segments: [{ segment: "velo", constat: "34,3 km/h.", conseil: "Reste en Z3." }],
  pointsForts: ["Natation régulière"],
  axesProgres: [{ titre: "Enchaînements", pourquoi: "Course effondrée.", travail: "Enchaînés vélo-course." }],
  prochaineCourse: "Pars plus prudemment.",
};

function afficher() {
  return render(
    <MemoryRouter>
      <AnalyseCourseCard course={COURSE} />
    </MemoryRouter>
  );
}

describe("analyse de course", () => {
  afterEach(() => {
    get.mockReset();
    post.mockReset();
    premium = true;
  });

  it("envoie les temps saisis et affiche le débrief du coach", async () => {
    get.mockResolvedValue({ data: { resultat: null, chiffres: null, analyse: null, genereLe: null } });
    post.mockResolvedValue({
      data: {
        resultat: null,
        chiffres: {
          segments: [{ segment: "velo", libelle: "Vélo", duree: "1:10:00", part: 45, allure: "34.3 km/h", fcMoyenne: 158 }],
          total: "2:36:00",
          ecartObjectifS: 360,
        },
        analyse: ANALYSE,
        genereLe: "2026-10-05T10:00:00.000Z",
      },
    });
    afficher();

    fireEvent.change(await screen.findByLabelText("Vélo"), { target: { value: "1:10:00" } });
    fireEvent.change(screen.getByLabelText("Course"), { target: { value: "52:00" } });
    fireEvent.change(screen.getByLabelText(/Comment s'est passée/), { target: { value: "Crampes au km 6." } });
    fireEvent.click(screen.getByRole("button", { name: "Analyser ma course" }));

    expect(await screen.findByText(ANALYSE.resume)).toBeInTheDocument();
    expect(post.mock.calls[0][0]).toBe("/races/c1/analyse");
    expect(post.mock.calls[0][1]).toMatchObject({ velo: "1:10:00", course: "52:00", ressenti: "Crampes au km 6.", fcVelo: null });
    expect(screen.getByText("34.3 km/h")).toBeInTheDocument();
    expect(screen.getByText("6 min au-dessus de l'objectif")).toBeInTheDocument();
    expect(screen.getByText("Enchaînements")).toBeInTheDocument();
  });

  it("ne demande qu'un temps et une FC pour une épreuve d'une seule discipline", async () => {
    get.mockResolvedValue({ data: { resultat: null, chiffres: null, analyse: null, genereLe: null } });
    post.mockResolvedValue({ data: { resultat: null, chiffres: null, analyse: ANALYSE, genereLe: null } });
    render(
      <MemoryRouter>
        <AnalyseCourseCard course={{ ...COURSE, discipline: "course", distanceKm: 10, format: "autre" }} />
      </MemoryRouter>
    );

    fireEvent.change(await screen.findByLabelText(/Votre temps/), { target: { value: "44:30" } });
    fireEvent.change(screen.getByLabelText("FC moyenne (bpm)"), { target: { value: "174" } });
    expect(screen.queryByLabelText("T1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Analyser ma course" }));

    expect(await screen.findByText(ANALYSE.resume)).toBeInTheDocument();
    expect(post.mock.calls[0][1]).toMatchObject({ total: "44:30", course: "44:30", fcCourse: 174 });
  });

  it("reprend une analyse déjà faite", async () => {
    get.mockResolvedValue({ data: { resultat: { velo: "1:10:00" }, chiffres: null, analyse: ANALYSE, genereLe: null } });
    afficher();
    expect(await screen.findByText(ANALYSE.resume)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Analyser ma course" })).not.toBeInTheDocument();
  });

  it("présente l'offre Premium aux autres athlètes", () => {
    premium = false;
    get.mockResolvedValue({ data: { resultat: null, chiffres: null, analyse: null, genereLe: null } });
    afficher();
    expect(screen.getByText("Analyse de course — offre Premium")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Découvrir Premium" })).toHaveAttribute("href", "/abonnement");
    expect(post).not.toHaveBeenCalled();
  });
});

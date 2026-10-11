import { useState } from "react";
import { FaBullseye, FaHeartPulse, FaPersonBiking, FaPersonRunning, FaPersonSwimming } from "react-icons/fa6";
import { api, apiErrorMessage, type PrecisionZone } from "../lib/api";

const NOMS: Record<PrecisionZone["discipline"], string> = {
  course: "Course",
  velo: "Vélo",
  natation: "Natation",
  frequenceCardiaque: "Fréquence cardiaque",
};

const ICONES = {
  course: FaPersonRunning,
  velo: FaPersonBiking,
  natation: FaPersonSwimming,
  frequenceCardiaque: FaHeartPulse,
} as const;

const BADGES: Record<PrecisionZone["niveau"], { texte: string; classe: string }> = {
  mesuree: { texte: "Mesurées", classe: "border-emerald-800 bg-emerald-950/40 text-emerald-300" },
  saisie: { texte: "Saisies", classe: "border-sky-800 bg-sky-950/40 text-sky-300" },
  estimee: { texte: "Estimées", classe: "border-amber-800 bg-amber-950/40 text-amber-300" },
  absente: { texte: "Absentes", classe: "border-bordure bg-zinc-900 text-doux" },
};

const TESTS: Record<NonNullable<PrecisionZone["test"]>, string> = {
  course: "Faire le test de 30 min",
  velo: "Faire le test FTP",
  natation: "Faire le test CSS",
};

/**
 * La précision de chaque jeu de zones, et le moyen de l'améliorer.
 *
 * Des zones estimées se lisaient comme des zones mesurées : rien ne disait à
 * l'athlète qu'une FC au seuil déduite de sa FC max peut se tromper de dix
 * battements, ni qu'un test de terrain de trente minutes règle la question.
 */
export function PrecisionZones({ precision, onTestDemande }: { precision: PrecisionZone[]; onTestDemande: () => void }) {
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function demander(sport: NonNullable<PrecisionZone["test"]>) {
    setEnvoi(sport);
    setErreur(null);
    try {
      await api.post("/tests/demander", { sport });
      onTestDemande();
    } catch (err) {
      setErreur(apiErrorMessage(err, "Impossible de programmer ce test."));
    } finally {
      setEnvoi(null);
    }
  }

  // Une FC mesurée par le test de course n'appelle pas un second bouton identique.
  const testsProposes = new Set<string>();

  return (
    <div className="rounded-2xl border border-bordure bg-zinc-950/80 p-4">
      <div className="mb-1 flex items-center gap-2">
        <FaBullseye className="text-accent" size={14} aria-hidden="true" />
        <h2 className="text-sm font-bold text-white">Précision de vos zones</h2>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-doux">
        Une zone n'est pas plus juste que la valeur dont elle part. Mesurées par un test, elles sont précises à quelques
        battements, watts ou secondes près ; estimées, l'écart peut atteindre 10 battements.
      </p>

      <ul className="space-y-2">
        {precision.map((p) => {
          const Icone = ICONES[p.discipline];
          const badge = BADGES[p.niveau];
          const aAmeliorer = p.niveau !== "mesuree" || p.aRefaire;
          const proposer = aAmeliorer && p.test && !testsProposes.has(p.test);
          if (proposer && p.test) testsProposes.add(p.test);
          return (
            <li key={p.discipline} className="rounded-xl bg-zinc-900/60 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-semibold text-fort">
                  <Icone size={13} aria-hidden="true" />
                  {NOMS[p.discipline]}
                </span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badge.classe}`}>
                  {p.aRefaire ? "À refaire" : badge.texte}
                </span>
              </div>
              <p className="mt-1 text-xs text-doux">
                {p.source}
                {p.aRefaire && " Ce test date de plus de 8 semaines : votre forme a changé depuis."}
              </p>
              {proposer && p.test && (
                <button
                  onClick={() => demander(p.test!)}
                  disabled={envoi !== null}
                  className="mt-2 rounded-lg border border-rose-800 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-950/40 disabled:opacity-50"
                >
                  {envoi === p.test ? "Programmation…" : TESTS[p.test]}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {erreur && <p className="mt-2 text-xs text-red-400">{erreur}</p>}

      <p className="mt-3 text-xs leading-relaxed text-tres-doux">
        Même mesurée, votre fréquence cardiaque varie de 5 à 10 battements d'un jour à l'autre selon la fatigue, la chaleur
        ou le sommeil : fiez-vous d'abord à l'allure et aux watts, la fréquence sert à contrôler. Importer vos séances
        depuis votre montre permet aussi de relever votre vraie FC max.
      </p>
    </div>
  );
}

import { useMemo } from "react";
import type { Session } from "../lib/api";

const SPORT_ICON: Record<Session["sport"], string> = {
  natation: "🏊",
  velo: "🚴",
  course: "🏃",
  renfo: "🏋️",
  repos: "😴",
};

const JOURS_COURTS = ["L", "M", "M", "J", "V", "S", "D"];

/**
 * Semaine d'un coup d'œil.
 *
 * L'application ne proposait qu'une liste verticale : pour savoir ce qui
 * l'attendait samedi, l'athlète devait faire défiler. Cette bande donne la
 * forme de la semaine — où sont les jours durs, où sont les jours de repos.
 */
export function VueSemaine({
  sessions,
  selectionId,
  onSelect,
}: {
  sessions: Session[];
  selectionId?: string | null;
  onSelect: (id: string) => void;
}) {
  const aujourdHui = new Date().toISOString().slice(0, 10);

  const jours = useMemo(
    () => [...sessions].sort((a, b) => a.date.localeCompare(b.date)),
    [sessions]
  );

  // La charge relative donne la hauteur des barres : c'est la silhouette de la
  // semaine qu'on lit, pas des minutes exactes.
  const maxDuree = Math.max(60, ...jours.map((s) => s.dureeMin));
  // `session.date` arrive en ISO complet : la partie heure doit être retirée
  // avant de reconstruire une date locale, sinon la concaténation est invalide.
  const jourCourt = (date: string) =>
    new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short" });

  if (jours.length === 0) return null;

  return (
    <div className="rounded-2xl border border-bordure bg-surface p-3">
      <ul className="flex items-end justify-between gap-1">
        {jours.map((session, index) => {
          const estAujourdHui = session.date.slice(0, 10) === aujourdHui;
          const repos = session.sport === "repos";
          const hauteur = repos ? 8 : Math.max(14, Math.round((session.dureeMin / maxDuree) * 96));

          return (
            <li key={session.id} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <button
                onClick={() => onSelect(session.id)}
                aria-label={`${session.titre}, ${session.dureeMin} minutes${estAujourdHui ? ", aujourd'hui" : ""}`}
                aria-pressed={selectionId === session.id}
                className="flex w-full flex-col items-center gap-1 rounded-lg py-1 transition-colors hover:bg-surface-haute"
              >
                <span aria-hidden="true" className="text-sm leading-none lg:text-xl">
                  {SPORT_ICON[session.sport]}
                </span>
                <span
                  aria-hidden="true"
                  style={{ height: `${hauteur}px` }}
                  className={`w-full max-w-7 rounded-sm transition-colors lg:max-w-12 ${
                    session.status === "faite"
                      ? "bg-succes"
                      : session.status === "manquee"
                        ? "bg-bordure-forte"
                        : repos
                          ? "bg-bordure"
                          : "bg-accent"
                  }`}
                />
                <span
                  className={`text-[10px] font-semibold ${
                    estAujourdHui ? "text-accent-clair" : "text-tres-doux"
                  }`}
                >
                  {/* Une initiale suffit sur téléphone ; l'abréviation tient à
                      l'aise dès qu'il y a de la place, et « M » ne désigne plus
                      deux jours différents. */}
                  <span className="lg:hidden">{JOURS_COURTS[index] ?? ""}</span>
                  <span className="hidden capitalize lg:inline">{jourCourt(session.date)}</span>
                </span>
                {!repos && (
                  <span className="hidden text-[10px] text-tres-doux lg:block">{session.dureeMin} min</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

import { useEffect, useState } from "react";
import { FaClockRotateLeft } from "react-icons/fa6";
import { api, type Activity } from "../lib/api";

/**
 * Date de la dernière activité importée.
 *
 * L'athlète ne savait pas si ses données étaient à jour : la charge et les
 * zones s'appuient sur les activités mesurées, mais rien ne disait quand la
 * dernière était arrivée. Un import oublié depuis trois semaines fausse
 * silencieusement toutes les lectures.
 */
export function FraicheurDonnees() {
  const [derniere, setDerniere] = useState<Activity | null | undefined>(undefined);

  useEffect(() => {
    api
      .get<{ activities: Activity[] }>("/activities")
      .then(({ data }) => setDerniere(data.activities[0] ?? null))
      .catch(() => setDerniere(null));
  }, []);

  if (derniere === undefined) return null;

  const jours = derniere
    ? Math.floor((Date.now() - new Date(derniere.startedAt).getTime()) / 86400000)
    : null;

  // Deux semaines sans rien : c'est le moment où les lectures commencent à
  // dater sans que personne s'en aperçoive.
  const perime = jours === null || jours > 14;

  return (
    <p
      className={`flex items-center gap-2 text-xs ${perime ? "text-attention" : "text-doux"}`}
    >
      <FaClockRotateLeft size={10} aria-hidden="true" />
      {jours === null
        ? "Aucune activité importée : votre charge est estimée à partir des séances cochées."
        : jours === 0
          ? "Dernière activité importée aujourd'hui."
          : `Dernière activité importée il y a ${jours} jour${jours > 1 ? "s" : ""}.`}
    </p>
  );
}

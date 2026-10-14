import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

interface Felicitations {
  titre: string;
  resume: string[];
  recuperation: string[];
  nutrition: string[] | null;
}

/**
 * Le message qui suit une séance faite : bravo, ce qu'elle a été, et comment
 * en récupérer. L'offre Premium y ajoute la nutrition de récupération dosée.
 */
export function FelicitationsSeance({ sessionId, status }: { sessionId: string; status: string }) {
  const [message, setMessage] = useState<{ felicitations: Felicitations | null; premium: boolean } | null>(null);
  const carte = useRef<HTMLDivElement>(null);

  // Le bouton « faite » est en bas de la fenêtre : le message apparaît en haut,
  // on l'amène sous les yeux de l'athlète.
  useEffect(() => {
    if (message?.felicitations) carte.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [message]);

  useEffect(() => {
    if (status !== "faite") return;
    let actif = true;
    api
      .get<{ felicitations: Felicitations | null; premium: boolean }>(`/sessions/${sessionId}/felicitations`)
      .then(({ data }) => {
        if (actif) setMessage(data);
      })
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [sessionId, status]);

  const f = message?.felicitations;
  if (!f) return null;

  return (
    <div ref={carte} className="animate-fade-in-up mb-4 rounded-xl border border-emerald-800/60 bg-gradient-to-br from-emerald-950/50 to-black p-3.5">
      <p className="mb-1 text-base font-bold text-emerald-200">{f.titre}</p>
      {f.resume.map((ligne) => (
        <p key={ligne} className="text-sm text-zinc-200">
          {ligne}
        </p>
      ))}

      <p className="mb-1 mt-3 text-xs font-bold uppercase tracking-wide text-emerald-400">Pour bien récupérer</p>
      <ul className="space-y-1">
        {f.nutrition?.map((ligne) => (
          <li key={ligne} className="text-xs leading-relaxed text-zinc-300">
            🍽️ {ligne}
          </li>
        ))}
        {f.recuperation.map((ligne) => (
          <li key={ligne} className="text-xs leading-relaxed text-zinc-300">
            · {ligne}
          </li>
        ))}
      </ul>
      {!message?.premium && (
        <p className="mt-2 text-[11px] text-doux">
          Nutrition de récupération dosée pour vous (protéines, glucides, réhydratation) :{" "}
          <Link to="/abonnement" className="font-semibold text-emerald-300 hover:underline">
            offre Premium
          </Link>
        </p>
      )}
    </div>
  );
}

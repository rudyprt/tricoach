import { Link } from "react-router-dom";
import type { BilanSeance as Bilan } from "../lib/api";

const STYLES: Record<Bilan["niveau"], { cadre: string; puce: string; titre: string }> = {
  conforme: { cadre: "border-emerald-900/60 bg-emerald-950/20", puce: "text-emerald-400", titre: "Séance conforme au programme" },
  ecart: { cadre: "border-amber-900/60 bg-amber-950/20", puce: "text-amber-400", titre: "Quelques écarts avec le programme" },
  alerte: { cadre: "border-red-900/60 bg-red-950/20", puce: "text-red-400", titre: "Écart important avec le programme" },
};

const PUCES: Record<Bilan["niveau"], string> = { conforme: "✓", ecart: "•", alerte: "!" };

/**
 * Ce qui a été fait, comparé à ce qui était prévu. Calcul fait par l'appli,
 * sans appel au coach IA : il s'affiche tout de suite et ne coûte rien. Le
 * réajustement n'est proposé que lorsque l'écart le justifie.
 */
export function BilanSeance({ bilan }: { bilan: Bilan }) {
  const style = STYLES[bilan.niveau];
  return (
    <div className={`rounded-xl border p-3 ${style.cadre}`}>
      <p className={`text-xs font-bold uppercase tracking-wide ${style.puce}`}>📊 {style.titre}</p>
      <ul className="mt-1.5 space-y-1">
        {bilan.constats.map((c) => (
          <li key={c.texte} className="flex gap-2 text-xs text-zinc-200">
            <span className={`font-bold ${STYLES[c.niveau].puce}`} aria-hidden="true">
              {PUCES[c.niveau]}
            </span>
            <span>{c.texte}</span>
          </li>
        ))}
      </ul>
      {bilan.proposerReajustement && (
        <Link
          to="/dashboard?reajuster=1"
          className="mt-2.5 inline-block rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-rose-400"
        >
          Réajuster ma semaine
        </Link>
      )}
    </div>
  );
}

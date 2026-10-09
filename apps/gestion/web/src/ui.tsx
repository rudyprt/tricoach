import type { ReactNode } from "react";

export function Carte({ titre, action, children, className = "" }: { titre?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-bordure bg-surface p-4 sm:p-5 ${className}`}>
      {(titre || action) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {titre && <h2 className="text-sm font-semibold text-doux">{titre}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

type Ton = "neutre" | "positif" | "negatif";

export function Stat({ libelle, valeur, detail, ton = "neutre" }: { libelle: string; valeur: string; detail?: ReactNode; ton?: Ton }) {
  const couleur = ton === "positif" ? "text-succes" : ton === "negatif" ? "text-danger" : "text-fort";
  return (
    <div className="rounded-2xl border border-bordure bg-surface p-4">
      <p className="text-xs font-medium text-doux">{libelle}</p>
      <p className={`mt-1 text-2xl font-bold tracking-tight ${couleur}`}>{valeur}</p>
      {detail && <p className="mt-1 text-xs text-tres-doux">{detail}</p>}
    </div>
  );
}

export function tonDe(cents: number): Ton {
  return cents > 0 ? "positif" : cents < 0 ? "negatif" : "neutre";
}

export function Bouton({
  children,
  onClick,
  type = "button",
  variante = "principal",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variante?: "principal" | "secondaire" | "danger";
  disabled?: boolean;
}) {
  const styles = {
    principal: "bg-accent text-white hover:bg-accent/90",
    secondaire: "border border-bordure-forte bg-surface-haute text-fort hover:bg-bordure",
    danger: "border border-danger/40 text-danger hover:bg-danger/10",
  }[variante];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`min-h-11 rounded-xl px-4 text-sm font-semibold transition disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

export function Champ({ libelle, aide, children }: { libelle: string; aide?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-doux">{libelle}</span>
      {children}
      {aide && <span className="mt-1 block text-xs text-tres-doux">{aide}</span>}
    </label>
  );
}

export const classeSaisie =
  "min-h-11 w-full rounded-xl border border-bordure-forte bg-fond px-3 text-sm text-fort placeholder:text-tres-doux focus:border-accent-clair focus:outline-none";

export function Erreur({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{message}</p>;
}

/** Barre de progression vers un seuil, avec le pourcentage en clair. */
export function Jauge({ libelle, valeur, max, detail }: { libelle: string; valeur: number; max: number; detail: string }) {
  const pct = max > 0 ? Math.min(100, (valeur / max) * 100) : 0;
  const couleur = pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-attention" : "bg-succes";
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-doux">{libelle}</span>
        <span className="font-semibold text-fort">{pct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-haute" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={libelle}>
        <div className={`h-full rounded-full ${couleur}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-tres-doux">{detail}</p>
    </div>
  );
}

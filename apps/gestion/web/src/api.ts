import type { Tableau } from "../../server/tableau";
import type { Parametres } from "../../server/parametres";
import type { Charge } from "../../server/calculs";

export type { Tableau, Parametres };
export type ChargeLigne = Charge & { notes: string | null };
export interface EncaissementLigne {
  id: string;
  date: string;
  libelle: string;
  categorie: "abonnement" | "autre";
  montantCents: number;
  fraisCents: number;
}

export class NonConnecte extends Error {}

export async function api<T>(chemin: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${chemin}`, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401) throw new NonConnecte();
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
  return data as T;
}

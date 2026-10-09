import { useState, type FormEvent } from "react";
import { api } from "../api";
import { Bouton, Champ, Erreur, classeSaisie } from "../ui";

export function Connexion({ onConnecte }: { onConnecte: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      await api("/connexion", { method: "POST", body: { email, password } });
      onConnecte();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Connexion impossible.");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <form onSubmit={soumettre} className="w-full max-w-sm space-y-4 rounded-2xl border border-bordure bg-surface p-6">
        <div>
          <h1 className="text-xl font-bold">TriCoach <span className="text-accent">Gestion</span></h1>
          <p className="mt-1 text-sm text-doux">Ton compte TriCoach administrateur.</p>
        </div>
        <Champ libelle="E-mail">
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={classeSaisie} />
        </Champ>
        <Champ libelle="Mot de passe">
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={classeSaisie} />
        </Champ>
        <Erreur message={erreur} />
        <Bouton type="submit" disabled={envoi}>{envoi ? "Connexion…" : "Se connecter"}</Bouton>
      </form>
    </main>
  );
}

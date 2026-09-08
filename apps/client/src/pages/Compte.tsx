import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaDownload, FaEnvelopeCircleCheck, FaLock, FaTriangleExclamation } from "react-icons/fa6";
import { api, apiErrorMessage } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { Spinner } from "../components/Spinner";

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">{children}</div>;
}

export function Compte() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [showDelete, setShowDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  function reset() {
    setMessage(null);
    setError(null);
  }

  async function resendVerification() {
    reset();
    setBusy("verif");
    try {
      const { data } = await api.post<{ alreadyVerified: boolean }>("/privacy/verify-email/resend");
      setMessage(
        data.alreadyVerified
          ? "Votre adresse est déjà confirmée."
          : "E-mail de confirmation envoyé. Pensez à regarder vos indésirables."
      );
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible d'envoyer l'e-mail de confirmation."));
    } finally {
      setBusy(null);
    }
  }

  /**
   * L'export passe par une requête authentifiée : on télécharge le contenu
   * puis on le remet à l'utilisateur, un lien direct ne portant pas le cookie
   * dans tous les navigateurs.
   */
  async function exportData() {
    reset();
    setBusy("export");
    try {
      const { data } = await api.get("/privacy/export", { responseType: "blob" });
      const url = URL.createObjectURL(data as Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tricoach-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage("Vos données ont été téléchargées.");
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible d'exporter vos données."));
    } finally {
      setBusy(null);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    reset();
    setBusy("password");
    try {
      await api.patch("/auth/password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setMessage("Mot de passe modifié.");
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible de modifier le mot de passe."));
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault();
    reset();
    setBusy("delete");
    try {
      await api.delete("/privacy/account", {
        data: { password: deletePassword, confirmation: deleteConfirmation },
      });
      await logout();
      navigate("/register", { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible de supprimer le compte."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">Mon compte</h1>
        <p className="mt-0.5 text-sm text-zinc-400">{user?.email}</p>
      </div>

      {message && (
        <p className="rounded-md border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          {message}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      {user && !user.emailVerified && (
        <Card>
          <div className="mb-2 flex items-center gap-2">
            <FaEnvelopeCircleCheck className="text-amber-400" size={14} />
            <h2 className="text-sm font-bold text-white">Adresse non confirmée</h2>
          </div>
          <p className="mb-3 text-sm text-zinc-400">
            Confirmez votre adresse pour pouvoir récupérer votre compte en cas d'oubli de mot de passe.
          </p>
          <button
            onClick={resendVerification}
            disabled={busy !== null}
            className="flex items-center justify-center gap-2 rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-black transition-colors hover:bg-rose-400 disabled:opacity-50"
          >
            {busy === "verif" && <Spinner className="border-black/30 border-t-black" />}
            Renvoyer l'e-mail de confirmation
          </button>
        </Card>
      )}

      <Card>
        <div className="mb-2 flex items-center gap-2">
          <FaLock className="text-zinc-400" size={13} />
          <h2 className="text-sm font-bold text-white">Mot de passe</h2>
        </div>
        <form onSubmit={changePassword} className="space-y-2">
          <input
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Mot de passe actuel"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-rose-500"
          />
          <input
            type="password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Nouveau mot de passe (8 caractères minimum)"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-rose-500"
          />
          <button
            type="submit"
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-rose-700 hover:text-white disabled:opacity-50"
          >
            {busy === "password" && <Spinner />}
            Changer mon mot de passe
          </button>
        </form>
      </Card>

      <Card>
        <div className="mb-2 flex items-center gap-2">
          <FaDownload className="text-zinc-400" size={13} />
          <h2 className="text-sm font-bold text-white">Mes données</h2>
        </div>
        <p className="mb-3 text-sm text-zinc-400">
          Téléchargez l'intégralité de ce que TriCoach conserve à votre sujet : profil, programmes, séances, ressentis
          et conversations avec le coach.
        </p>
        <button
          onClick={exportData}
          disabled={busy !== null}
          className="flex items-center justify-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-rose-700 hover:text-white disabled:opacity-50"
        >
          {busy === "export" && <Spinner />}
          Télécharger mes données
        </button>
      </Card>

      <Card>
        <div className="mb-2 flex items-center gap-2">
          <FaTriangleExclamation className="text-red-500" size={13} />
          <h2 className="text-sm font-bold text-white">Supprimer mon compte</h2>
        </div>
        <p className="mb-3 text-sm text-zinc-400">
          Efface définitivement votre compte, vos programmes, vos séances et vos conversations. Cette action est
          irréversible.
        </p>

        {!showDelete ? (
          <button
            onClick={() => {
              reset();
              setShowDelete(true);
            }}
            className="rounded-lg border border-red-900/60 px-3 py-2 text-sm text-red-400 transition-colors hover:border-red-700 hover:text-red-300"
          >
            Supprimer mon compte
          </button>
        ) : (
          <form onSubmit={deleteAccount} className="space-y-2">
            <input
              type="password"
              required
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder="Votre mot de passe"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-red-600"
            />
            <input
              required
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              placeholder="Écrivez SUPPRIMER pour confirmer"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-red-600"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy !== null || deleteConfirmation !== "SUPPRIMER"}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-40"
              >
                {busy === "delete" && <Spinner className="border-white/30 border-t-white" />}
                Supprimer définitivement
              </button>
              <button
                type="button"
                onClick={() => setShowDelete(false)}
                className="rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-700"
              >
                Annuler
              </button>
            </div>
          </form>
        )}
      </Card>

      <p className="pb-2 text-center text-xs text-zinc-600">
        <Link to="/conditions" className="hover:text-zinc-400 hover:underline">
          Conditions d'utilisation
        </Link>
        {" · "}
        <Link to="/confidentialite" className="hover:text-zinc-400 hover:underline">
          Politique de confidentialité
        </Link>
      </p>
    </div>
  );
}

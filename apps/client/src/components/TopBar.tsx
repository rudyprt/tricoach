import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaPen, FaCheck, FaXmark } from "react-icons/fa6";
import { useAuth } from "../lib/AuthContext";
import { api, apiErrorMessage, avatarUrl } from "../lib/api";

function resizeImageToDataUrl(file: File, maxSize = 256, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Image invalide."));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas indisponible."));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function TopBar() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  // L'image n'est plus incluse dans les réponses de l'API : elle est servie par
  // une route dédiée, mise en cache par le navigateur.
  const photo = avatarUrl(user);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      await api.patch("/auth/avatar", { avatarUrl: dataUrl });
      await refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible de mettre à jour la photo."));
    } finally {
      setUploading(false);
    }
  }

  function startEditingName() {
    setNameDraft(user?.name ?? "");
    setEditingName(true);
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setError(null);
    setSavingName(true);
    try {
      await api.patch("/auth/username", { name: trimmed });
      await refresh();
      setEditingName(false);
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible de mettre à jour le nom."));
    } finally {
      setSavingName(false);
    }
  }

  return (
    <div data-impression="masquer" className="relative shrink-0 border-b border-zinc-900 bg-black">
      <div className="flex items-center justify-between px-4 py-3.5">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex h-8 w-8 items-center justify-center text-xl text-white transition-transform duration-150 active:scale-90"
          aria-label="Menu"
        >
          ☰
        </button>
        <button
          onClick={() => navigate("/dashboard")}
          aria-label="Revenir à mon programme"
          className="text-lg font-black italic tracking-wide text-white transition-transform duration-150 active:scale-95"
        >
          TRI<span className="text-rose-500">COACH</span>
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          aria-label="Changer la photo de profil"
          className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rose-600 text-sm font-bold text-white transition-transform duration-150 active:scale-90 disabled:opacity-60"
        >
          {photo ? (
            <img src={photo} alt="" className="h-full w-full object-cover" />
          ) : (
            user?.name?.[0]?.toUpperCase() ?? "?"
          )}
          {uploading && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/60">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            </span>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {error && (
        <div className="animate-fade-in-up absolute right-4 top-full z-20 mt-1 max-w-[240px] rounded-lg border border-red-900 bg-red-950/90 px-3 py-2 text-xs text-red-300 shadow-2xl">
          {error}
        </div>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="animate-fade-in-up absolute right-4 top-full z-20 mt-1 w-56 rounded-xl border border-zinc-800 bg-zinc-950 p-2 shadow-2xl">
            {!editingName ? (
              <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                <p className="truncate text-sm text-zinc-300">{user?.name}</p>
                <button
                  onClick={startEditingName}
                  aria-label="Modifier le nom d'utilisateur"
                  className="shrink-0 text-zinc-500 transition-colors hover:text-white"
                >
                  <FaPen size={11} />
                </button>
              </div>
            ) : (
              <form onSubmit={saveName} className="flex items-center gap-1 px-1 py-1">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  maxLength={40}
                  className="w-full min-w-0 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm text-white outline-none focus:border-rose-500"
                />
                <button
                  type="submit"
                  disabled={savingName}
                  aria-label="Enregistrer"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-emerald-500 transition-colors hover:bg-zinc-900 disabled:opacity-50"
                >
                  <FaCheck size={11} />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingName(false)}
                  aria-label="Annuler"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900"
                >
                  <FaXmark size={11} />
                </button>
              </form>
            )}
            <button
              onClick={() => {
                setOpen(false);
                fileInputRef.current?.click();
              }}
              className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-900"
            >
              Changer la photo
            </button>
            <button
              onClick={() => {
                setOpen(false);
                navigate("/abonnement");
              }}
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-900"
            >
              Mon abonnement
              {user?.plan !== "free" && (
                <span className="rounded-full bg-rose-600/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-400">
                  {user?.plan}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                navigate("/compte");
              }}
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-900"
            >
              Mon compte
              {user && !user.emailVerified && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Adresse e-mail non confirmée" />
              )}
            </button>
            {user?.role === "admin" && (
              <button
                onClick={() => {
                  setOpen(false);
                  navigate("/admin");
                }}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm text-amber-300 transition-colors hover:bg-zinc-900"
              >
                Administration
                <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-400">
                  admin
                </span>
              </button>
            )}
            <button
              onClick={handleLogout}
              className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-red-400 transition-colors hover:bg-zinc-900"
            >
              Déconnexion
            </button>
          </div>
        </>
      )}
    </div>
  );
}

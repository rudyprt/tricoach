import { useEffect, useState } from "react";

const CLE_REFUS = "tricoach-gestion.installation.refusee";

/** Événement Chromium, absent des types du DOM. */
interface InvitePromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function estIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
}

function estDejaInstallee(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Invitation à ajouter l'outil à l'écran d'accueil. Android propose une
 * invite native ; iOS n'en a aucune, il faut décrire le geste.
 */
export function Installer() {
  const [invite, setInvite] = useState<InvitePromptEvent | null>(null);
  const [ios] = useState(() => estIOS());
  const [masquee, setMasquee] = useState(() => {
    if (estDejaInstallee()) return true;
    try {
      return localStorage.getItem(CLE_REFUS) !== null;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (masquee || ios) return;
    const surInvite = (e: Event) => {
      e.preventDefault();
      setInvite(e as InvitePromptEvent);
    };
    window.addEventListener("beforeinstallprompt", surInvite);
    return () => window.removeEventListener("beforeinstallprompt", surInvite);
  }, [masquee, ios]);

  function refuser() {
    setMasquee(true);
    try {
      localStorage.setItem(CLE_REFUS, "1");
    } catch {
      // Sans stockage, l'invitation reviendra à la prochaine visite.
    }
  }

  async function installer() {
    if (!invite) return;
    await invite.prompt();
    const { outcome } = await invite.userChoice;
    if (outcome === "accepted") setMasquee(true);
    setInvite(null);
  }

  if (masquee || (!ios && !invite)) return null;

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-accent/30 bg-accent/10 p-4">
      <img src="/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Ajoute Gestion à ton écran d'accueil</p>
        {ios ? (
          <p className="mt-1 text-xs text-doux">
            Dans Safari, appuie sur <strong className="text-fort">Partager</strong>{" "}
            <span aria-hidden>⬆︎</span>, puis <strong className="text-fort">Sur l'écran d'accueil</strong>.
          </p>
        ) : (
          <button
            onClick={() => void installer()}
            className="mt-2 min-h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent/90"
          >
            Installer
          </button>
        )}
      </div>
      <button onClick={refuser} aria-label="Ne plus proposer" className="-m-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-tres-doux hover:text-fort">
        ✕
      </button>
    </div>
  );
}

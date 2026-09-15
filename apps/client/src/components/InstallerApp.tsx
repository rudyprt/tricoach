import { useEffect, useState } from "react";
import { FaMobileScreen, FaXmark, FaArrowUpFromBracket, FaPlus } from "react-icons/fa6";
import { estDejaInstallee, estIOS, type InvitePromptEvent } from "../lib/pwa";

const CLE_REFUS = "tricoach.installation.refusee";

/**
 * Invitation à installer l'application sur l'écran d'accueil.
 *
 * Un programme d'entraînement se consulte au bord du bassin ou avant de partir
 * courir : installée, l'application s'ouvre d'un geste et reste lisible sans
 * réseau. Sur iOS aucune invite n'existe, il faut décrire la manipulation.
 */
export function InstallerApp() {
  const [invite, setInvite] = useState<InvitePromptEvent | null>(null);
  const [afficherIOS, setAfficherIOS] = useState(false);
  const [masquee, setMasquee] = useState(true);

  useEffect(() => {
    if (estDejaInstallee()) return;
    try {
      if (localStorage.getItem(CLE_REFUS)) return;
    } catch {
      // Navigation privée : on propose quand même.
    }

    setMasquee(false);

    if (estIOS()) {
      setAfficherIOS(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setInvite(e as InvitePromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

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

  if (masquee || (!invite && !afficherIOS)) return null;

  return (
    <div className="rounded-2xl border border-rose-900/40 bg-gradient-to-b from-rose-950/30 to-zinc-950/80 p-4">
      <div className="flex items-start gap-3">
        <FaMobileScreen className="mt-0.5 shrink-0 text-rose-400" size={16} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white">Installez TriCoach sur votre écran d'accueil</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            Votre programme s'ouvre d'un geste, et reste consultable même sans réseau — au bord du bassin ou au
            départ d'une sortie.
          </p>

          {afficherIOS ? (
            <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-300">
              Appuyez sur
              <FaArrowUpFromBracket className="text-sky-400" size={11} />
              <span className="font-semibold">Partager</span>, puis
              <FaPlus className="text-sky-400" size={10} />
              <span className="font-semibold">Sur l'écran d'accueil</span>.
            </p>
          ) : (
            <button
              onClick={() => void installer()}
              className="mt-2.5 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-500"
            >
              Installer
            </button>
          )}
        </div>
        <button
          onClick={refuser}
          aria-label="Ne plus proposer"
          className="shrink-0 rounded-full p-1 text-zinc-600 transition-colors hover:text-zinc-300"
        >
          <FaXmark size={14} />
        </button>
      </div>
    </div>
  );
}

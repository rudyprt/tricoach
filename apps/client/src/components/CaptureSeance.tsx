import { useRef, useState, type FormEvent } from "react";
import { FaCamera } from "react-icons/fa6";
import { api, apiErrorMessage, type BilanSeance, type Session } from "../lib/api";
import { Bouton } from "../ui/Bouton";

interface Mesures {
  dureeMin?: number;
  distanceKm: number | null;
  allureSecParKm: number | null;
  fcMoyenne: number | null;
  fcMax: number | null;
  puissanceMoy: number | null;
  denivelePosM: number | null;
}

type Champ = keyof Omit<Mesures, "allureSecParKm">;

const CHAMPS: { cle: Champ; label: string; sports?: Session["sport"][] }[] = [
  { cle: "dureeMin", label: "Durée (min)" },
  { cle: "distanceKm", label: "Distance (km)", sports: ["course", "velo", "natation"] },
  { cle: "fcMoyenne", label: "FC moyenne" },
  { cle: "fcMax", label: "FC max" },
  { cle: "puissanceMoy", label: "Puissance moy. (W)", sports: ["velo"] },
  { cle: "denivelePosM", label: "Dénivelé + (m)", sports: ["course", "velo"] },
];

const versTexte = (v: number | null | undefined) => (v == null ? "" : String(v));
const versNombre = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

function allureTexte(s: number | null): string {
  return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "";
}
function allureSecondes(t: string): number | null {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Import d'une capture d'écran de séance (Strava, Garmin Connect, Coros...).
 *
 * Tout le monde n'a pas le fichier de sa montre sous la main. Le coach lit les
 * chiffres de la capture ; l'athlète les vérifie et les corrige avant qu'ils
 * n'entrent dans son historique. L'image n'est pas conservée.
 */
export function CaptureSeance({
  session,
  onValidee,
}: {
  session: Session;
  onValidee: (bilan: BilanSeance | null, dureeMin: number) => Promise<void> | void;
}) {
  const entree = useRef<HTMLInputElement>(null);
  const [lecture, setLecture] = useState(false);
  const [valeurs, setValeurs] = useState<Record<Champ, string> | null>(null);
  const [allure, setAllure] = useState("");
  const [avertissements, setAvertissements] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function lire(e: React.ChangeEvent<HTMLInputElement>) {
    const images = Array.from(e.target.files ?? []).slice(0, 4);
    e.target.value = "";
    if (images.length === 0) return;
    setLecture(true);
    setError(null);
    try {
      const corps = new FormData();
      images.forEach((image) => corps.append("captures", image));
      const { data } = await api.post<{ mesures: Mesures; avertissements: string[] }>(
        `/sessions/${session.id}/capture`,
        corps
      );
      setValeurs(
        Object.fromEntries(CHAMPS.map(({ cle }) => [cle, versTexte(data.mesures[cle])])) as Record<Champ, string>
      );
      setAllure(allureTexte(data.mesures.allureSecParKm));
      setAvertissements(data.avertissements);
    } catch (err) {
      setError(apiErrorMessage(err, "Lecture impossible."));
    } finally {
      setLecture(false);
    }
  }

  async function valider(e: FormEvent) {
    e.preventDefault();
    if (!valeurs) return;
    setError(null);
    try {
      const corps = {
        ...Object.fromEntries(CHAMPS.map(({ cle }) => [cle, versNombre(valeurs[cle])])),
        allureSecParKm: session.sport === "course" ? allureSecondes(allure) : null,
      };
      const { data } = await api.post<{ bilan: BilanSeance | null }>(`/sessions/${session.id}/capture/valider`, corps);
      setValeurs(null);
      await onValidee(data.bilan, Number(versNombre(valeurs.dureeMin)));
    } catch (err) {
      setError(apiErrorMessage(err, "Enregistrement impossible."));
    }
  }

  const champ =
    "mt-0.5 w-full rounded-md border border-bordure bg-zinc-950 px-2.5 py-1.5 text-sm text-white outline-none focus:border-rose-500";

  return (
    <div className="space-y-2">
      <input ref={entree} type="file" accept="image/*" multiple className="hidden" onChange={lire} />
      {!valeurs && (
        <Bouton
          variante="secondaire"
          pleineLargeur
          enCours={lecture}
          icone={<FaCamera size={12} />}
          onClick={() => entree.current?.click()}
        >
          {lecture ? "Lecture de la capture..." : "Importer une capture d'écran"}
        </Bouton>
      )}
      {error && (
        <p role="alert" className="text-center text-xs text-accent-clair">
          {error}
        </p>
      )}

      {valeurs && (
        <form onSubmit={valider} className="space-y-2 rounded-xl border border-bordure bg-zinc-900/60 p-3">
          <p className="text-xs font-semibold text-zinc-300">Vérifiez les valeurs lues, puis validez.</p>
          {avertissements.map((a) => (
            <p key={a} className="rounded-lg bg-amber-950/40 px-2.5 py-1.5 text-xs text-amber-200">
              {a}
            </p>
          ))}
          <div className="grid grid-cols-2 gap-2">
            {CHAMPS.filter((c) => !c.sports || c.sports.includes(session.sport)).map((c) => (
              <label key={c.cle} className="block text-xs text-doux">
                {c.label}
                <input
                  inputMode="decimal"
                  required={c.cle === "dureeMin"}
                  value={valeurs[c.cle]}
                  onChange={(e) => setValeurs({ ...valeurs, [c.cle]: e.target.value })}
                  className={champ}
                />
              </label>
            ))}
            {session.sport === "course" && (
              <label className="block text-xs text-doux">
                Allure (min/km)
                <input value={allure} onChange={(e) => setAllure(e.target.value)} placeholder="5:07" className={champ} />
              </label>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-black transition-colors hover:bg-rose-400"
            >
              Valider la séance
            </button>
            <button
              type="button"
              onClick={() => setValeurs(null)}
              className="rounded-lg border border-bordure px-3 py-2 text-sm text-doux hover:text-zinc-200"
            >
              Annuler
            </button>
          </div>
          <p className="text-[11px] text-tres-doux">L'image n'est pas conservée : seules ces valeurs le sont.</p>
        </form>
      )}
    </div>
  );
}

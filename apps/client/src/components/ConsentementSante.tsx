/**
 * Consentement au traitement des blessures, douleurs et ressentis.
 *
 * Ces informations sont des données de santé : le règlement européen en fait
 * une catégorie particulière, qui exige un consentement explicite et séparé —
 * pas une acceptation globale des conditions à l'inscription. D'où une case
 * distincte, décochée par défaut, placée sous le champ qu'elle couvre.
 *
 * Elle n'est pas la garantie : le serveur refuse d'enregistrer le champ rempli
 * sans consentement, parce qu'une case cochée dans un navigateur ne prouve
 * rien et qu'un appel direct à l'API la contournerait.
 */
export function ConsentementSante({
  coche,
  onChange,
  acquisLe,
}: {
  coche: boolean;
  onChange: (valeur: boolean) => void;
  /** Date du consentement déjà donné : il se retire depuis « Mon compte », pas ici. */
  acquisLe?: string | null;
}) {
  if (acquisLe) {
    return (
      <p className="mt-2 text-xs leading-relaxed text-tres-doux">
        Consentement aux données de santé donné le {new Date(acquisLe).toLocaleDateString("fr-FR")}. Vous pouvez le
        retirer depuis Mon compte : ces données seront alors effacées.
      </p>
    );
  }
  return (
    <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-doux">
      <input
        type="checkbox"
        checked={coche}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-rose-500"
      />
      <span>
        J'accepte que TriCoach enregistre mes blessures, douleurs et ressentis après séance, et les transmette à son
        prestataire d'IA, pour adapter mes programmes. Je peux retirer ce consentement à tout moment depuis Mon compte.
      </span>
    </label>
  );
}

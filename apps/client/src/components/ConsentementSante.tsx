/**
 * Consentement au traitement des blessures et douleurs.
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
}: {
  coche: boolean;
  onChange: (valeur: boolean) => void;
}) {
  return (
    <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-doux">
      <input
        type="checkbox"
        checked={coche}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-rose-500"
      />
      <span>
        J'accepte que TriCoach utilise les informations sur mes blessures ou douleurs pour adapter mon
        programme. Je peux retirer mon consentement à tout moment en vidant ce champ.
      </span>
    </label>
  );
}

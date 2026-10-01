import { EDITEUR, LIBELLES, champsManquants, editeurComplet, type Editeur } from "../config/editeur.ts";

/**
 * Pages légales, servies en HTML statique.
 *
 * Elles étaient rendues par l'application React : sans JavaScript (robot
 * d'indexation, vérificateur d'un prestataire de paiement, lecteur dont le
 * bundle échoue, ancien navigateur), on obtenait une page vide. Des documents
 * dont la loi exige qu'ils soient accessibles ne peuvent pas dépendre du
 * chargement de l'application. Ce module produit donc des pages autonomes —
 * aucun script, styles en ligne — que Vite écrit dans dist/ à la compilation
 * (voir vite.config.ts) et qu'Express sert telles quelles.
 *
 * Le texte décrit fidèlement ce que l'application fait des données, tel que le
 * code le fait réellement. L'identité de l'éditeur vient d'un seul fichier
 * (src/config/editeur.ts) : tant qu'elle est incomplète, un avertissement
 * s'affiche, et disparaît de lui-même une fois les champs remplis.
 */

export interface PageLegale {
  /** Chemin servi, sans barre initiale : « conditions » → /conditions. */
  chemin: string;
  titre: string;
  html: (e?: Editeur) => string;
}

const VERSION = "2026-09";

function esc(texte: string): string {
  return texte
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Une valeur renseignée, ou un repli en italique si elle manque. */
function champ(valeur: string | null, defaut: string): string {
  if (valeur) return `<span class="fort">${esc(valeur)}</span>`;
  return `<span class="manquant">[${esc(defaut)}]</span>`;
}

function lien(href: string, texte: string): string {
  return `<a href="${href}">${texte}</a>`;
}

function section(titre: string, contenu: string): string {
  return `<section><h2>${titre}</h2>${contenu}</section>`;
}

const STYLES = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #000;
  color: #f4f4f5;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-text-size-adjust: 100%;
}
main { max-width: 42rem; margin: 0 auto; padding: 2rem 1rem calc(2rem + env(safe-area-inset-bottom, 0px)); }
.retour { font-size: .875rem; color: #a8a8b3; text-decoration: none; }
.retour:hover { color: #d4d4d8; text-decoration: underline; }
h1 { margin: 1rem 0 0; font-size: 1.5rem; font-weight: 900; font-style: italic; letter-spacing: .025em; color: #fff; }
.version { margin: .25rem 0 0; font-size: .75rem; color: #a8a8b3; }
.alerte { margin-top: 1rem; border: 1px solid rgb(120 53 15 / .6); background: rgb(69 26 3 / .3); border-radius: .375rem; padding: .5rem .75rem; font-size: .75rem; color: #fcd34d; }
.alerte p { margin: 0; }
.alerte strong { font-weight: 600; }
.alerte code { color: #fde68a; }
.contenu { margin-top: 1.25rem; font-size: .875rem; line-height: 1.625; }
section { margin-top: 1.25rem; color: #a8a8b3; }
h2 { margin: 0 0 .375rem; font-size: 1rem; font-weight: 700; color: #fff; }
section p { margin: .5rem 0 0; }
section h2 + p, section h2 + ul, section h2 + dl { margin-top: 0; }
ul { margin: .5rem 0 0; padding-left: 1.25rem; }
li + li { margin-top: .25rem; }
dl { margin: 0; }
dl div { display: flex; flex-wrap: wrap; column-gap: .5rem; }
dl div + div { margin-top: .375rem; }
dd { margin: 0; }
.fort, strong { color: #d4d4d8; }
.manquant { font-style: italic; color: #a8a8b3; }
a { color: #fb7185; text-decoration: none; }
a:hover { text-decoration: underline; }
a:focus-visible { outline: 2px solid #f43f5e; outline-offset: 2px; border-radius: 2px; }
`;

function page(titre: string, e: Editeur, contenu: string): string {
  const alerte = editeurComplet(e)
    ? ""
    : `<div class="alerte"><p><strong>Document incomplet</strong></p><p>À renseigner dans <code>apps/client/src/config/editeur.ts</code> : ${champsManquants(
        e
      )
        .map((c) => esc(LIBELLES[c]))
        .join(", ")}.</p></div>`;

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="theme-color" content="#09090b" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<title>${titre} — TriCoach</title>
<style>${STYLES}</style>
</head>
<body>
<main>
<a class="retour" href="/">← Retour à TriCoach</a>
<h1>${titre}</h1>
<p class="version">Version ${VERSION}</p>
${alerte}
<div class="contenu">
${contenu}
</div>
</main>
</body>
</html>
`;
}

function conditions(e: Editeur = EDITEUR): string {
  return page(
    "Conditions d'utilisation",
    e,
    [
      section(
        "Objet",
        `<p>TriCoach met à disposition un service de génération de programmes d'entraînement en triathlon, assisté par intelligence artificielle, ainsi qu'un suivi de séances et un espace de discussion avec un coach virtuel.</p>`
      ),
      section(
        "Éditeur",
        `<p>Le service est édité par ${champ(e.nom, "l'éditeur")}. ${lien("/mentions-legales", "Voir les mentions légales complètes")}.</p>`
      ),
      section(
        "Compte",
        `<p>La création d'un compte requiert une adresse e-mail valide et un mot de passe d'au moins 8 caractères. Vous êtes responsable de la confidentialité de vos identifiants. Un compte est personnel et ne peut être partagé.</p>`
      ),
      section(
        "Offres et essai",
        `<p>Chaque nouveau compte bénéficie d'une période d'essai de 14 jours donnant accès à la génération de programmes. Au-delà, l'accès aux fonctions de programmation nécessite une offre payante. Les tarifs affichés dans l'application s'entendent toutes taxes comprises, par mois.</p>
<p>L'abonnement est mensuel et sans engagement de durée : il peut être résilié à tout moment depuis la page « Mon abonnement », la résiliation prenant effet à la fin de la période en cours.</p>
<p>Conformément à l'article L221-28 du code de la consommation, vous disposez d'un délai de rétractation de 14 jours à compter de la souscription. En demandant l'accès immédiat au service, vous acceptez que son exécution commence avant la fin de ce délai.</p>`
      ),
      section(
        "Avertissement — santé",
        `<p class="fort">Les programmes proposés sont générés automatiquement à partir des informations que vous déclarez. Ils ne constituent ni un avis médical, ni un diagnostic, ni une prescription. Ils ne remplacent pas l'avis d'un médecin, d'un kinésithérapeute ou d'un entraîneur diplômé.</p>
<p class="fort">Consultez un médecin avant de reprendre ou d'intensifier une activité sportive, en particulier en cas de douleur, de blessure, de pathologie connue ou de reprise après une interruption prolongée. Interrompez toute séance en cas de douleur inhabituelle.</p>`
      ),
      section(
        "Limites du service",
        `<p>Le service repose sur un modèle d'intelligence artificielle : ses productions peuvent comporter des erreurs ou des recommandations inadaptées à votre situation. Vous restez seul juge de leur pertinence. Le service est fourni sans garantie de disponibilité continue.</p>`
      ),
      section(
        "Résiliation",
        `<p>Vous pouvez ${lien("/compte#supprimer", "supprimer votre compte")} à tout moment. La suppression est définitive et entraîne l'effacement de vos données, dans les conditions décrites par la ${lien("/confidentialite", "politique de confidentialité")}.</p>`
      ),
    ].join("\n")
  );
}

function confidentialite(e: Editeur = EDITEUR): string {
  return page(
    "Politique de confidentialité",
    e,
    [
      section(
        "Responsable du traitement",
        // L'adresse n'est affichée que lorsqu'elle existe ou qu'elle est due.
        // Un « [adresse à préciser] » en travers de la politique ressemble à
        // une page inachevée, là où le règlement demande surtout un
        // responsable identifiable et joignable — ce que le nom et l'adresse
        // de contact suffisent à établir.
        `<p>${champ(e.nom, "L'éditeur du service")}${
          e.adresse || e.professionnel ? `, ${champ(e.adresse, "adresse à préciser")}` : ""
        }. Contact : ${champ(e.email, "adresse e-mail à préciser")}.</p>`
      ),
      section(
        "Données collectées",
        `<p>Le service enregistre uniquement les données que vous fournissez ou qui découlent de votre usage :</p>
<ul>
<li><strong>Compte</strong> — adresse e-mail, nom d'utilisateur, photo de profil si vous en ajoutez une, fuseau horaire, mot de passe (conservé sous forme chiffrée irréversible).</li>
<li><strong>Profil sportif</strong> — objectif et sa date, temps de référence par discipline, FTP, heures disponibles, zones d'entraînement.</li>
<li><strong>Données de santé déclarées</strong> — blessures, douleurs et contraintes que vous signalez, ressenti après chaque séance. Ces informations sont sensibles : elles ne sont enregistrées que parce que vous les saisissez, et uniquement pour adapter vos programmes.</li>
<li><strong>Entraînement</strong> — programmes générés, séances, statut et historique.</li>
<li><strong>Échanges</strong> — messages envoyés au coach virtuel et ses réponses.</li>
<li><strong>Usage</strong> — date de dernière connexion et volume de sollicitation du modèle, à des fins de suivi technique et de facturation interne.</li>
</ul>
<p>Aucun traceur publicitaire n'est utilisé. Le seul cookie déposé est celui de votre session, nécessaire au fonctionnement du service.</p>`
      ),
      section(
        "Finalités et bases légales",
        `<ul>
<li>Fournir le service et générer vos programmes — exécution du contrat.</li>
<li>Traiter vos données de santé déclarées — votre consentement explicite, donné par une case distincte sous le champ des blessures, et retirable à tout moment en vidant ce champ. Sans ce consentement, ces informations ne sont pas enregistrées.</li>
<li>Sécuriser les accès et prévenir les abus — intérêt légitime.</li>
<li>Gérer les abonnements — exécution du contrat et obligations comptables.</li>
</ul>`
      ),
      section(
        "Destinataires",
        `<p>Vos données ne sont ni vendues ni cédées. Elles sont transmises aux seuls prestataires techniques nécessaires au fonctionnement :</p>
<ul>
<li><strong>Anthropic</strong> — les éléments de votre profil et de votre historique utiles à la génération sont transmis au modèle Claude pour produire vos programmes et les réponses du coach.</li>
<li><strong>Hébergeur</strong> — ${champ(e.hebergeur, "hébergeur à préciser")}.</li>
</ul>`
      ),
      // L'application supprime réellement les comptes inactifs : la page doit
      // le dire, faute de quoi l'effacement reposerait sur une règle que
      // personne n'a pu lire.
      section(
        "Durée de conservation",
        `<p>Vos données sont conservées tant que votre compte est actif. Elles sont effacées dans les trente jours suivant sa suppression.</p>
<p>Un compte resté <strong>deux ans sans connexion</strong> est supprimé automatiquement, avec l'ensemble de son historique. Un e-mail vous prévient trente jours avant : il suffit de vous reconnecter une fois pour conserver votre compte.</p>
<p>Les jetons de réinitialisation et de vérification expirent automatiquement.</p>`
      ),
      section(
        "Vos droits",
        `<p>Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité. Deux d'entre eux s'exercent directement dans l'application, sans démarche :</p>
<ul>
<li><strong>Portabilité et accès</strong> — téléchargez l'intégralité de vos données au format JSON depuis ${lien("/compte", "Mon compte")}.</li>
<li><strong>Effacement</strong> — ${lien("/compte#supprimer", "supprimez définitivement votre compte")} et toutes vos données.</li>
</ul>
<p>Vous pouvez également introduire une réclamation auprès de la CNIL (<span class="fort">www.cnil.fr</span>).</p>
<p>Pour les autres droits, écrivez à ${champ(e.email, "l'adresse de contact de l'éditeur")}.</p>`
      ),
      section(
        "Sécurité",
        `<p>Les mots de passe sont conservés hachés et jamais en clair. Les échanges sont chiffrés en transit. L'accès aux données d'un compte est strictement limité à son titulaire et, pour la gestion des abonnements, aux administrateurs du service, dont les actions sont journalisées.</p>`
      ),
    ].join("\n")
  );
}

function ligne(label: string, valeur: string | null): string {
  return `<div><dt>${label} :</dt><dd>${champ(valeur, "à compléter")}</dd></div>`;
}

/**
 * Ligne d'une mention qui n'est due qu'à un éditeur professionnel.
 *
 * Tant que le service est gratuit et édité à titre non professionnel, il n'y a
 * ni numéro ni téléphone à publier : afficher « [à compléter] » donnerait à
 * l'athlète une page qui paraît inachevée, pour un renseignement que la loi ne
 * réclame pas encore. La ligne apparaît dès que la valeur existe, et dès que
 * l'activité devient professionnelle — où le vide redevient un manquement.
 */
function ligneSiDue(label: string, valeur: string | null, professionnel: boolean): string {
  if (!valeur && !professionnel) return "";
  return ligne(label, valeur);
}

function mentionsLegales(e: Editeur = EDITEUR): string {
  const societe = e.forme === "societe";
  const lignes = [
    ligne(societe ? "Dénomination" : "Nom", e.nom),
    e.nomCommercial ? ligne("Nom commercial", e.nomCommercial) : "",
    societe ? ligne("Forme juridique", e.formeSociale) : "",
    societe ? ligne("Capital social", e.capital) : "",
    ligneSiDue("Adresse", e.adresse, e.professionnel),
    ligneSiDue(societe ? "RCS" : "SIREN", e.immatriculation, e.professionnel),
    e.tva ? ligne("TVA intracommunautaire", e.tva) : "",
    ligne("E-mail", e.email),
    ligneSiDue("Téléphone", e.telephone, e.professionnel),
    ligne("Directeur de la publication", e.directeurPublication),
  ].join("");

  return page(
    "Mentions légales",
    e,
    [
      section("Éditeur du service", `<dl>${lignes}</dl>`),
      section(
        "Hébergement",
        `<p>${champ(e.hebergeur, "hébergeur à préciser")}</p>${
          e.professionnel
            ? ""
            : `<p>Le service est actuellement édité à titre non professionnel et mis à disposition gratuitement : il ne donne lieu ni à immatriculation, ni à numéro de TVA. L'identité de l'éditeur a été communiquée à l'hébergeur ci-dessus.</p>`
        }`
      ),
      section(
        "Propriété intellectuelle",
        `<p>Les contenus du service (interface, textes, identité visuelle) sont protégés. Les programmes générés pour votre compte vous sont destinés et vous pouvez les exporter librement depuis « Mon compte ».</p>`
      ),
      section(
        "Médiation de la consommation",
        `<p>En cas de litige non résolu avec le service, vous pouvez recourir gratuitement à un médiateur de la consommation, ou à la plateforme européenne de règlement en ligne des litiges.</p>`
      ),
      section(
        "Documents liés",
        `<p>${lien("/conditions", "Conditions d'utilisation")} · ${lien("/confidentialite", "Politique de confidentialité")}</p>`
      ),
    ].join("\n")
  );
}

export const PAGES_LEGALES: PageLegale[] = [
  { chemin: "conditions", titre: "Conditions d'utilisation", html: conditions },
  { chemin: "confidentialite", titre: "Politique de confidentialité", html: confidentialite },
  { chemin: "mentions-legales", titre: "Mentions légales", html: mentionsLegales },
];

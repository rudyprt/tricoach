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

const VERSION = "2026-10";

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
        `<p>TriCoach met à disposition un service de génération de programmes d'entraînement en triathlon, assisté par intelligence artificielle, ainsi qu'un suivi de séances, un espace de discussion avec un coach virtuel et, selon l'offre, des analyses de course et des repères de nutrition autour de l'effort.</p>`
      ),
      section(
        "Éditeur",
        `<p>Le service est édité par ${champ(e.nom, "l'éditeur")}. ${lien("/mentions-legales", "Voir les mentions légales complètes")}.</p>`
      ),
      section(
        "Accès au service",
        `<p>Le service est réservé aux personnes <strong>âgées de 18 ans ou plus</strong>. En créant un compte, vous déclarez remplir cette condition.</p>`
      ),
      section(
        "Compte",
        `<p>La création d'un compte requiert une adresse e-mail valide et un mot de passe d'au moins 8 caractères. Vous êtes responsable de la confidentialité de vos identifiants. Un compte est personnel et ne peut être partagé.</p>`
      ),
      section(
        "Offres et essai",
        `<p>Chaque nouveau compte bénéficie d'une période d'essai gratuite de 14 jours donnant accès aux fonctions de l'offre Standard. Au-delà, ces fonctions nécessitent une offre payante :</p>
<ul>
<li><strong>Standard</strong> — génération et ajustement des programmes hebdomadaires, suivi des séances, coach virtuel (nombre de messages quotidien limité).</li>
<li><strong>Premium</strong> — l'offre Standard, plus un quota de messages plus élevé, l'analyse des courses disputées, la répartition du temps par zone, la détection de surentraînement et la nutrition d'entraînement et de course.</li>
</ul>
<p>Les tarifs affichés dans l'application s'entendent toutes taxes comprises, par mois. Le contenu de chaque offre est celui décrit sur la page « Mon abonnement » au moment de la souscription.</p>
<p><strong>Le paiement en ligne n'est pas encore ouvert.</strong> Lorsqu'il le sera, il sera opéré par la société Stripe, et des conditions générales de vente préciseront les modalités de paiement, de renouvellement et de résiliation avant toute souscription.</p>`
      ),
      section(
        "Droit de rétractation",
        `<p>Conformément à l'article L221-18 du code de la consommation, vous disposerez d'un délai de 14 jours à compter de la souscription d'un abonnement pour vous rétracter. Au moment du paiement, vous demandez expressément que votre abonnement démarre immédiatement. En cas de rétractation, vous payez alors uniquement la part du mois déjà écoulée jusqu'à votre demande (article L221-25).</p>`
      ),
      section(
        "Avertissement — santé",
        `<p class="fort">Les programmes, conseils du coach, analyses de course et repères de nutrition sont générés automatiquement à partir des informations que vous déclarez. Ils ne constituent ni un avis médical ou diététique, ni un diagnostic, ni une prescription. Ils ne remplacent pas l'avis d'un médecin, d'un kinésithérapeute, d'un diététicien ou d'un entraîneur diplômé.</p>
<p class="fort">Consultez un médecin avant de reprendre ou d'intensifier une activité sportive, en particulier en cas de douleur, de blessure, de pathologie connue, de trouble alimentaire ou de reprise après une interruption prolongée. Interrompez toute séance en cas de douleur inhabituelle.</p>`
      ),
      section(
        "Contenus que vous envoyez",
        `<p>Vous pouvez transmettre au service des fichiers de montre, des captures d'écran et des photos. N'envoyez que des contenus qui vous concernent et que vous avez le droit de partager ; évitez d'y faire figurer des tiers. Les captures et photos sont lues pour en extraire les informations utiles, puis ne sont pas conservées.</p>
<p>Le lien de partage d'une semaine rend votre programme consultable, sans compte, par toute personne à qui vous le transmettez, jusqu'à son expiration. Votre ressenti et votre journal de nutrition n'y figurent pas.</p>`
      ),
      section(
        "Limites du service",
        `<p>Le service repose sur un modèle d'intelligence artificielle : ses productions peuvent comporter des erreurs ou des recommandations inadaptées à votre situation. Vous restez seul juge de leur pertinence. Le service est fourni sans garantie de disponibilité continue.</p>`
      ),
      section(
        "Résiliation",
        `<p>Vous pouvez ${lien("/compte#supprimer", "supprimer votre compte")} à tout moment. La suppression est définitive et entraîne l'effacement de vos données, dans les conditions décrites par la ${lien("/confidentialite", "politique de confidentialité")}.</p>`
      ),
      section(
        "Évolution des conditions",
        `<p>Ces conditions peuvent évoluer avec le service. Toute nouvelle version vous est signalée dans l'application, et votre accord vous est redemandé.</p>`
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
<li><strong>Compte</strong> — adresse e-mail, nom d'utilisateur, photo de profil si vous en ajoutez une, fuseau horaire, mot de passe (conservé sous forme chiffrée irréversible), date et version de votre accord aux présentes conditions.</li>
<li><strong>Profil sportif</strong> — objectif et sa date, temps visé, temps de référence par discipline et fréquences cardiaques relevées sur ces courses, valeurs de seuil (FTP, allure, FC), heures et créneaux disponibles, matériel, zones d'entraînement.</li>
<li><strong>Données de santé déclarées</strong> — blessures, douleurs et contraintes que vous signalez, interruptions d'entraînement et leur motif, ressenti après chaque séance.</li>
<li><strong>Données physiologiques et de nutrition</strong> (offre Premium) — poids, tests de sudation (pesées avant et après une séance), préférences de ravitaillement, journal de ce que vous prenez pendant l'effort et de votre tolérance digestive.</li>
<li><strong>Entraînement</strong> — programmes générés, séances, statut, durée réelle, activités importées (fichiers de montre, Strava si vous le connectez, valeurs lues sur vos captures d'écran : durée, distance, allure, fréquence cardiaque, puissance, dénivelé), tests de terrain.</li>
<li><strong>Courses</strong> — calendrier de vos courses, plans de course, résultats que vous saisissez (temps, classement, conditions, récit) et analyses produites.</li>
<li><strong>Échanges avec le coach</strong> — messages, réponses, résumé automatique des échanges plus anciens, consignes que le coach retient pour vos programmes. Les photos jointes à un message sont transmises au modèle pour être lues, puis ne sont pas conservées : seule la mention de leur envoi reste dans le fil.</li>
<li><strong>Notifications</strong> — si vous les activez, l'adresse technique d'abonnement de votre navigateur.</li>
<li><strong>Usage</strong> — date de dernière connexion et volume de sollicitation du modèle, à des fins de suivi technique et de maîtrise des coûts.</li>
</ul>
<p>Aucun traceur publicitaire ni outil de mesure d'audience n'est utilisé. Le seul cookie déposé est celui de votre session, nécessaire au fonctionnement du service ; l'application conserve aussi dans votre navigateur quelques préférences d'affichage.</p>`
      ),
      section(
        "Finalités et bases légales",
        `<ul>
<li>Fournir le service, générer vos programmes, analyses et repères — exécution du contrat.</li>
<li>Traiter vos données de santé déclarées — votre consentement explicite, donné par une case distincte sous le champ des blessures ou du ressenti. Sans ce consentement, ces informations ne sont pas enregistrées et le service reste utilisable. Vous pouvez le retirer à tout moment depuis « Mon compte » : les données de santé déjà enregistrées sont alors effacées.</li>
<li>Traiter vos données physiologiques et de nutrition — votre consentement, exprimé en les saisissant vous-même : elles sont facultatives, et vous pouvez les modifier ou les effacer à tout moment depuis la page Nutrition.</li>
<li>Sécuriser les accès et prévenir les abus — intérêt légitime.</li>
<li>Gérer les abonnements — exécution du contrat et obligations comptables.</li>
</ul>`
      ),
      section(
        "Destinataires",
        `<p>Vos données ne sont ni vendues ni cédées. Elles sont transmises aux seuls prestataires techniques nécessaires au fonctionnement, chacun pour ce qui le concerne :</p>
<ul>
<li><strong>Anthropic</strong> (États-Unis) — les éléments de votre profil, de votre historique et de vos messages utiles à la réponse, ainsi que les captures et photos que vous envoyez, sont transmis au modèle Claude pour produire vos programmes, analyses et réponses du coach.</li>
<li><strong>Hébergement de l'application</strong> — ${champ(e.hebergeur, "hébergeur à préciser")}.</li>
<li><strong>Base de données</strong> — Neon, qui héberge la base où sont enregistrées vos données.</li>
<li><strong>Envoi d'e-mails</strong> — le prestataire d'envoi des e-mails du service (vérification d'adresse, réinitialisation du mot de passe, rappels), qui reçoit votre adresse e-mail et le contenu du message.</li>
<li><strong>Strava</strong> — uniquement si vous connectez votre compte : TriCoach y lit vos activités.</li>
<li><strong>Services de notification</strong> de votre navigateur ou de votre téléphone — uniquement si vous activez les notifications.</li>
<li><strong>Stripe</strong> — lorsque le paiement en ligne sera ouvert, pour encaisser les abonnements : vos coordonnées de paiement sont saisies chez Stripe et ne transitent pas par TriCoach.</li>
</ul>`
      ),
      section(
        "Transferts hors de l'Union européenne",
        `<p>Certains de ces prestataires, dont Anthropic et l'hébergeur de l'application, sont établis aux États-Unis. Ces transferts sont encadrés par les clauses contractuelles types de la Commission européenne ou par le cadre de protection des données UE–États-Unis (Data Privacy Framework) auquel ces prestataires adhèrent.</p>`
      ),
      // L'application supprime réellement les comptes inactifs : la page doit
      // le dire, faute de quoi l'effacement reposerait sur une règle que
      // personne n'a pu lire.
      section(
        "Durée de conservation",
        `<p>Vos données sont conservées tant que votre compte est actif. Elles sont effacées dans les trente jours suivant sa suppression.</p>
<p>Un compte resté <strong>deux ans sans connexion</strong> est supprimé automatiquement, avec l'ensemble de son historique. Un e-mail vous prévient trente jours avant : il suffit de vous reconnecter une fois pour conserver votre compte.</p>
<p>Les captures d'écran et photos ne sont pas conservées après leur lecture. Effacer la conversation avec le coach efface aussi son résumé. Les liens de partage expirent automatiquement, tout comme les jetons de réinitialisation et de vérification.</p>`
      ),
      section(
        "Vos droits",
        `<p>Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité, et du droit de retirer votre consentement à tout moment. Trois d'entre eux s'exercent directement dans l'application, sans démarche :</p>
<ul>
<li><strong>Portabilité et accès</strong> — téléchargez l'intégralité de vos données au format JSON depuis ${lien("/compte", "Mon compte")}.</li>
<li><strong>Effacement</strong> — ${lien("/compte#supprimer", "supprimez définitivement votre compte")} et toutes vos données.</li>
<li><strong>Retrait du consentement santé</strong> — depuis ${lien("/compte", "Mon compte")}, retirez-le : vos blessures, douleurs et ressentis sont aussitôt effacés.</li>
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
        `<p>En cas de litige non résolu avec le service, vous pouvez recourir gratuitement à un médiateur de la consommation. Le médiateur compétent sera désigné ici avant l'ouverture du paiement en ligne.</p>`
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

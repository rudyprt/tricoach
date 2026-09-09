# TriCoach IA

Application de coaching triathlon : chaque athlète crée un compte, répond à un
questionnaire (objectif, date, résultats précédents, heures disponibles,
blessures/contraintes), reçoit un programme hebdomadaire généré par IA
(Claude), suit son historique avec une courbe de progression, et discute avec
son coach IA en chat.

Le programme est construit sur une **périodisation** (fondation → développement
→ spécifique → affûtage → course) et sur des **zones d'entraînement calculées**
à partir des temps de référence de l'athlète, pas réinventées à chaque
génération. Chaque zone reste **modifiable à la main** : un athlète qui connaît
ses allures les saisit, et ce sont ces valeurs qui servent aux programmes. Les
séances sont exportables vers un agenda au format iCalendar.

Relié à **Strava**, le coach raisonne sur les allures réellement mesurées par la
montre, et non sur ce que l'athlète déclare avoir fait.

## Structure

- `apps/server` — API Node.js/Express + TypeScript, base Postgres via Prisma, appels à l'API Anthropic (Claude). En production, sert aussi le frontend compilé (une seule URL).
- `apps/client` — Application React + TypeScript (Vite), Tailwind CSS, React Router, Recharts.

## Installation

Prérequis : [Node.js](https://nodejs.org) 18+, une base Postgres (ex : gratuite et permanente sur [Neon](https://neon.tech)).

```bash
npm install
```

### Configuration

```bash
cp apps/server/.env.example apps/server/.env
```

Renseignez au minimum `DATABASE_URL` et `JWT_SECRET` (32 caractères minimum) dans
`apps/server/.env`. Le serveur valide sa configuration au démarrage et refuse de
démarrer avec un message explicite si une variable manque ou est invalide.

Générer un secret :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Puis initialisez la base :

```bash
npm run prisma:migrate -w apps/server
```

### Clé API Anthropic (coach IA)

Les fonctionnalités IA (génération du programme, chat) nécessitent une clé
API Anthropic :

1. Créez un compte sur [console.anthropic.com](https://console.anthropic.com).
2. Générez une clé API dans la section "API Keys".
3. Ajoutez-la dans `apps/server/.env` :
   ```
   ANTHROPIC_API_KEY="sk-ant-..."
   ```

Sans clé, l'application reste utilisable (compte, onboarding, historique)
mais affiche un message clair à la place du programme/chat IA.

### Abonnements et paiement

Aucun prestataire de paiement n'est branché pour l'instant. Le serveur refuse
donc l'activation d'une offre payante depuis l'application (`BILLING_MODE=disabled`,
valeur par défaut) : sans cela, n'importe quel compte connecté pourrait se
passer en Premium par un simple appel API. Pour tester les offres en local ou en
démo, passez `BILLING_MODE="open"` dans `apps/server/.env`.

La résiliation vers l'offre gratuite reste toujours possible.

### Envoi des e-mails

La réinitialisation de mot de passe et la confirmation d'adresse passent par
e-mail. Sans configuration SMTP, les messages sont seulement tracés dans les
logs : **la récupération de compte ne fonctionne alors pas réellement**, et
l'espace d'administration l'affiche en évidence.

#### Mise en place avec Brevo (gratuit, 300 e-mails/jour)

Tout se fait depuis un navigateur, téléphone compris.

1. Créez un compte sur [brevo.com](https://www.brevo.com) et confirmez votre
   adresse.
2. Menu de votre compte (en haut à droite) → **SMTP & API** → onglet **SMTP**.
3. Cliquez sur **Générer une nouvelle clé SMTP**. Notez les trois valeurs
   affichées : le serveur (`smtp-relay.brevo.com`), votre **login** (une
   adresse e-mail terminant par `@smtp-brevo.com`) et la **clé** — elle n'est
   montrée qu'une seule fois.
4. Reportez-les chez votre hébergeur (Render → votre service → *Environment*),
   avec les autres variables ci-dessous.
5. Enregistrez : le service redémarre. Allez ensuite dans l'application, onglet
   **Administration**, et cliquez sur **Envoyer un e-mail de test**. Si vous le
   recevez, c'est terminé. Sinon, le message d'erreur affiché vient directement
   du serveur d'envoi et dit quoi corriger.

Sans nom de domaine à vous, laissez `MAIL_FROM` sur une adresse générique : les
messages partiront, mais avec un risque accru d'atterrir en indésirables. Avec
un domaine, configurez SPF et DKIM chez Brevo pour une délivrabilité correcte.

#### Variables

Renseignez dans `apps/server/.env` (ou chez votre hébergeur) :

```
SMTP_HOST="smtp-relay.brevo.com"
SMTP_PORT=587
SMTP_USER="votre-identifiant"
SMTP_PASSWORD="votre-cle"
MAIL_FROM="TriCoach <ne-pas-repondre@votre-domaine.fr>"
APP_URL="https://votre-service.onrender.com"
```

N'importe quel service SMTP convient (Brevo, Resend, Postmark, Mailgun, ou même
un compte dédié chez votre fournisseur). `APP_URL` doit pointer sur l'adresse
publique de l'application : c'est elle qui construit les liens des e-mails.

### Remontée des erreurs (recommandé)

Sans récepteur configuré, une panne serveur ne se découvre qu'en lisant les logs
de l'hébergeur. Renseignez `ERROR_WEBHOOK_URL` avec l'URL d'un webhook (Slack,
Discord, ou tout service acceptant du JSON) pour être alerté. Les erreurs
identiques sont regroupées sur 5 minutes, et l'identifiant de l'athlète n'est
jamais transmis au service externe.

### Connexion Strava (facultatif)

Reliée, elle permet au coach de travailler sur les **allures réellement
mesurées** plutôt que sur le déclaratif, et valide automatiquement les séances
effectuées. Sans identifiants, la fonctionnalité n'apparaît simplement pas dans
l'application.

1. Rendez-vous sur [strava.com/settings/api](https://www.strava.com/settings/api)
   et créez une application.
2. Dans **Authorization Callback Domain**, indiquez le nom d'hôte de votre
   `APP_URL`, sans `https://` (par exemple `tricoach.onrender.com`).
3. Reportez chez votre hébergeur :

```
STRAVA_CLIENT_ID="votre-client-id"
STRAVA_CLIENT_SECRET="votre-client-secret"
```

L'athlète relie ensuite son compte depuis « Mon compte ». L'import remonte 30
jours à la première synchronisation, puis seulement les nouveautés.

Le rapprochement entre une activité importée et une séance planifiée est
volontairement strict — même jour, même discipline. Un rapprochement erroné
marquerait une séance comme faite à tort et fausserait la progression de charge
de la semaine suivante ; mieux vaut une activité non rattachée.

## Mentions légales

Les pages **Conditions d'utilisation**, **Politique de confidentialité** et
**Mentions légales** décrivent fidèlement ce que l'application fait des données.
Seule l'identité de l'éditeur reste à renseigner, dans **un unique fichier** :

```
apps/client/src/config/editeur.ts
```

Remplacez chaque `null` par sa valeur, puis redéployez. Tant qu'un champ
obligatoire manque, les pages affichent un avertissement nommant précisément ce
qui reste à compléter — cet avertissement est visible par vos utilisateurs, et
disparaît de lui-même une fois le fichier rempli.

Ces mentions sont obligatoires pour tout site professionnel accessible en France
(article 6 III de la LCEN). Elles supposent une structure déclarée : facturer un
abonnement sans immatriculation n'est pas possible légalement. Le mode de
facturation reste d'ailleurs désactivé par défaut (`BILLING_MODE=disabled`),
donc personne ne peut souscrire tant que vous ne l'activez pas.

Le contenu rédigé ici décrit le fonctionnement réel du service, mais n'a pas
valeur de conseil juridique : faites-le relire avant d'ouvrir les abonnements.

## Administration

Un compte peut avoir le rôle `admin`. Il accède alors à `/admin` dans
l'application : abonnements, fréquentation et coût du coach IA.

Le tout premier administrateur ne peut pas se désigner depuis l'application —
un bouton « me promouvoir » viderait le contrôle d'accès de son sens. Deux
façons de l'amorcer, au choix.

**Sans terminal (depuis un navigateur, y compris sur téléphone)**

1. Créez votre compte normalement dans l'application.
2. Chez votre hébergeur (Render → votre service → *Environment*), ajoutez la
   variable `ADMIN_EMAILS` avec votre email. Plusieurs adresses possibles,
   séparées par des virgules.
3. Enregistrez : le service redémarre, et votre compte devient administrateur
   au rechargement de l'application. Inutile de vous reconnecter.

Seuls des comptes **déjà inscrits** sont promus : la variable ne crée jamais de
compte. D'où l'ordre des étapes — inscrivez-vous *avant* de renseigner votre
adresse, pour qu'elle ne reste pas disponible pour quelqu'un d'autre. Une fois
la promotion faite, la variable peut être vidée : le rôle est enregistré en
base.

**En ligne de commande**

```bash
# après avoir créé le compte normalement depuis l'application
npm run admin -w apps/server -- promote vous@exemple.com
npm run admin -w apps/server -- list
npm run admin -w apps/server -- demote ancien-admin@exemple.com
```

Ensuite, dans les deux cas, un administrateur peut en promouvoir d'autres
directement depuis l'interface.

L'espace d'administration donne :

- **Comptes et abonnements** — total, répartition par offre, taux de
  conversion, essais en cours, essais expirés restés gratuits, inscriptions
  sur 7 et 30 jours.
- **Fréquentation** — actifs à 24 h / 7 j / 30 j, comptes jamais revenus,
  rétention sur 30 jours, et une série journalière (inscriptions, actifs,
  coût) sur le dernier mois.
- **Coût du coach IA** — tokens et coût estimé par période, par type d'appel
  (chat, génération, progression) et par athlète, avec le coût moyen par
  abonné. L'estimation s'appuie sur les tarifs publics Anthropic relevés à la
  date affichée dans `apps/server/src/lib/pricing.ts` ; c'est un repère, pas
  une facture.
- **Gestion des abonnements** — activer ou résilier une offre pour un compte.
  C'est le seul chemin qui accorde une offre payante tant qu'aucun paiement
  n'est branché. Chaque changement est journalisé (qui, quand, sur qui, quel
  motif) et consultable dans l'onglet *Journal*.

Deux garde-fous : le rôle est relu en base à chaque requête (une révocation est
immédiate, sans attendre l'expiration du cookie de 30 jours), et un
administrateur ne peut pas se retirer son propre rôle — il faut en promouvoir
un autre d'abord.

## Lancer l'application

```bash
npm run dev
```

- Client : http://localhost:5173
- API : http://localhost:3001

## Vérifications (types, lint, tests)

```bash
npm run check          # typecheck + lint + tests
npm run typecheck
npm run lint
npm run test
```

Les tests couvrent la logique métier (zones, périodisation, fuseaux, validation
des réponses IA, abonnements, tarification, rate limiting) et l'API complète en
intégration, y compris le contrôle d'accès de l'espace d'administration.
Les suites d'intégration nécessitent une base Postgres jetable :

```bash
createdb tricoach_test
export TEST_DATABASE_URL="postgresql://localhost:5432/tricoach_test"
DATABASE_URL="$TEST_DATABASE_URL" npm run prisma:deploy -w apps/server
npm run test
```

Sans `TEST_DATABASE_URL`, ces suites sont ignorées et seuls les tests unitaires
s'exécutent. La CI GitHub Actions (`.github/workflows/ci.yml`) lance l'ensemble
sur un service Postgres.

## Explorer la base de données

```bash
npm run prisma:studio
```

## Déploiement (Render)

Le fichier `render.yaml` à la racine décrit un déploiement en un seul service web
(build du client + serveur, le serveur sert ensuite les deux depuis la même URL).

1. Poussez ce projet sur un dépôt GitHub.
2. Sur [render.com](https://render.com), "New +" → "Blueprint", connectez le dépôt.
3. Render détecte `render.yaml` et crée le service. Renseignez les variables
   marquées `sync: false` dans l'onglet *Environment* du service :
   - `DATABASE_URL` (chaîne de connexion Postgres, ex. Neon)
   - `ANTHROPIC_API_KEY`
   - `ADMIN_EMAILS` (facultatif, voir *Administration* plus bas)
4. Premier déploiement : quelques minutes. L'URL fournie par Render
   (`https://<nom-du-service>.onrender.com`) est permanente et partageable.

Le plan gratuit Render met le service en veille après 15 min d'inactivité : la
première requête après une pause prend quelques secondes de plus (cold start),
le lien lui-même ne change jamais.

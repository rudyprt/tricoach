# TriCoach IA

Application de coaching triathlon : chaque athlète crée un compte, répond à un
questionnaire (objectif, date, résultats précédents, heures disponibles,
blessures/contraintes), reçoit un programme hebdomadaire généré par IA
(Claude), suit son historique avec une courbe de progression, et discute avec
son coach IA en chat.

Le programme est construit sur une **périodisation** (fondation → développement
→ spécifique → affûtage → course) et sur des **zones d'entraînement calculées**
à partir des temps de référence de l'athlète, pas réinventées à chaque
génération. Les séances sont exportables vers un agenda au format iCalendar.

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
des réponses IA, abonnements, rate limiting) et l'API complète en intégration.
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
4. Premier déploiement : quelques minutes. L'URL fournie par Render
   (`https://<nom-du-service>.onrender.com`) est permanente et partageable.

Le plan gratuit Render met le service en veille après 15 min d'inactivité : la
première requête après une pause prend quelques secondes de plus (cold start),
le lien lui-même ne change jamais.

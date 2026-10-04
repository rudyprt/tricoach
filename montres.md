# Récupérer les séances depuis les montres

Décision du 4 octobre 2026 : **on garde l'import manuel de fichiers `.fit`.**
Les démarches Garmin seront faites une fois la micro-entreprise créée.

Ce document existe pour qu'on ne refasse pas la recherche. Les constats
ci-dessous datent d'octobre 2026 et ces programmes changent leurs règles ;
revérifiez avant d'agir.

## Ce qui marche aujourd'hui

L'athlète exporte le fichier `.fit` de sa montre et le dépose dans
l'application, depuis la séance elle-même. Suivent automatiquement : le
rapprochement avec la séance prévue, la durée réelle, la fréquence cardiaque
du résumé, la charge et les zones.

Aucune plateforme, aucune approbation, aucun abonnement, toutes les marques.
Son seul défaut est le geste supplémentaire demandé à l'athlète.

## Pourquoi les trois voies automatiques ont été écartées

| Voie | Obstacle constaté |
|---|---|
| **Strava** | « L'accès à l'API Strava est réservé aux abonné(e)s » — vu sur la page de création d'application. ~12 €/mois pour l'éditeur. **Reste inconnu** : si chaque athlète doit lui aussi être abonné. Si oui, la fonctionnalité est morte ; si non, c'est le meilleur rapport des trois, puisque la plupart des montres se synchronisent déjà vers Strava. |
| **Garmin direct** | Le programme développeur exige une **personne morale** ; les candidatures à titre personnel sont rejetées. Des sources tierces rapportent en outre une suspension des inscriptions en 2026 (non confirmé par Garmin). Gratuit pour les partenaires approuvés. |
| **Agrégateur** (Terra, Rook, Spike, Junction) | Fonctionne immédiatement, sans approbation Garmin : ils détiennent le partenariat et poussent les données normalisées vers un webhook. Payant — abonnement de base plus tarif par utilisateur, montants non publics. Donne Garmin **et** toutes les autres marques. |

Question laissée ouverte sur Strava comme sur Garmin : leurs conditions
autorisent-elles à transmettre les données de l'athlète à un fournisseur de
modèle de langage ? Il ne s'agit pas d'entraîner un modèle, mais de passer les
données de l'athlète en contexte pour une inférence qui ne lui est rendue qu'à
lui. Les deux contrats n'ont pas pu être lus (domaines inaccessibles).
Chercher `train`, `machine learning`, `artificial intelligence`, `third party`.

## À faire quand la micro-entreprise existera

1. Passer `professionnel` à `true` dans `apps/client/src/config/editeur.ts`, et
   renseigner adresse, SIREN et téléphone — les pages légales les réclameront
   d'elles-mêmes.
2. Vérifier sur `developer.garmin.com/gc-developer-program/` si les
   inscriptions sont rouvertes, puis candidater. Le texte de candidature se
   trouve dans l'historique de la session liée en bas de ce document.
3. En attendant l'approbation, demander un devis à deux agrégateurs : c'est la
   seule voie disponible sans délai.

## Ce que le code attend déjà

Brancher une nouvelle source est court, parce que rien en aval n'est spécifique
à Strava :

- `NormalizedActivity` (dans `apps/server/src/lib/strava.ts`) ne décrit qu'une
  activité : identifiant externe, sport, date, durée, distance, dénivelé, FC
  moyenne et max, puissance, allure. Aucun champ propre à Strava.
- `Activity.source` est une chaîne libre (`"strava"` par défaut) : `"garmin"`
  passe **sans migration**.
- Déduplication par `source` + `externalId`, rapprochement avec la séance
  prévue, mise à jour de la durée réelle : tout existe et sert déjà au `.fit`.

Il reste donc à écrire une fonction `normalize()` pour le format du nouveau
fournisseur et une route de webhook. Compter une journée.

À noter : **aucun webhook n'existe aujourd'hui**, pas même pour Strava.
`fetchActivities` n'est appelé que depuis `POST /strava/sync`, déclenché par
l'athlète. Rendre l'import automatique suppose ce webhook, quelle que soit la
source retenue.

## Conséquence RGPD, à ne pas oublier

Un agrégateur devient destinataire de données de santé. La politique de
confidentialité ne cite aujourd'hui qu'Anthropic et l'hébergeur : il faudra l'y
ajouter dans `apps/client/src/legal/pagesLegales.ts`, section « Destinataires ».
Obligatoire, et deux lignes.

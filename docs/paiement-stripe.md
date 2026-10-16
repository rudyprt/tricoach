# Brancher le paiement (Stripe) — à faire le jour venu

## Mode test (branché)

Le paiement est codé de bout en bout, mais ne fonctionne qu'avec une **clé de
test** Stripe (aucun argent ne circule ; une clé `sk_live_` est refusée) et
n'est visible que des comptes listés dans `STRIPE_TESTEURS` et des
administrateurs. Les autres comptes gardent l'écran actuel.

Mise en route (pas besoin de SIRET pour le mode test) :

1. Créer un compte sur stripe.com, rester en **mode test** (interrupteur en haut).
2. *Développeurs → Clés API* : copier la **clé secrète de test** (`sk_test_...`).
3. *Développeurs → Webhooks → Ajouter un endpoint* :
   - URL : `https://<votre-app>.onrender.com/api/billing/webhook`
   - Événements : `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`,
     `invoice.payment_failed`.
   - Copier le **secret de signature** (`whsec_...`).
4. Sur Render (*Environment*) :
   - `STRIPE_SECRET_KEY=sk_test_...`
   - `STRIPE_WEBHOOK_SECRET=whsec_...`
   - `STRIPE_TESTEURS=moi@exemple.fr,ami@exemple.fr` (séparés par des virgules)
5. Payer avec la carte `4242 4242 4242 4242`, une date future, n'importe quel code.

Le passage en réel se fera en remplaçant les clés par des clés `sk_live_`,
après avoir levé le verrou du code et coché la liste ci-dessous.

Le paiement en ligne n'est pas encore branché : la page Abonnement l'annonce
« bientôt ». Le jour où on branche Stripe, encaisser ne suffit pas — vendre un
abonnement à des particuliers en France impose ce qui suit, **avant le premier
paiement**.

## Côté administratif (à faire par le propriétaire)

- [ ] Statut : micro-entreprise au minimum, avec un SIRET (Stripe le demande).
- [ ] Médiateur de la consommation : adhérer à un organisme agréé et le citer dans les CGV.
- [ ] Déclaration du chiffre d'affaires à l'URSSAF (mensuelle ou trimestrielle).
- [ ] Assurance responsabilité civile professionnelle (recommandée : l'appli donne des conseils d'entraînement).
- [ ] Faire relire les CGV par un juriste ou la CCI.

## Côté application (à développer)

- [x] Stripe Checkout + webhooks : abonnement, renouvellement, échec de paiement (mode test).
- [x] Conditions acceptées explicitement avant de payer (case à cocher, date conservée).
- [x] Droit de rétractation : case « je demande l'accès immédiat », rétractation au prorata.
- [x] Résiliation en fin de période depuis l'appli, réversible tant que la période court.
- [x] Prix affichés TTC.
- [ ] Lever le verrou « sk_test_ uniquement » (apps/server/src/lib/stripe.ts) et ouvrir à tous les comptes.
- [ ] Factures émises par Stripe, avec la mention « TVA non applicable, art. 293 B du CGI » tant que l'activité est sous le seuil de franchise.
- [ ] Mentions légales : SIRET, adresse, médiateur.
- [ ] Politique de confidentialité : Stripe ajouté parmi les sous-traitants.
- [ ] Rédiger une première version des CGV (à faire relire).

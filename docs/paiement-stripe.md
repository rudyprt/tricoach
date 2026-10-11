# Brancher le paiement (Stripe) — à faire le jour venu

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

- [ ] Stripe Checkout + webhooks : abonnement, renouvellement, échec de paiement, fin d'essai de 14 jours.
- [ ] CGV acceptées explicitement avant de payer (case à cocher, version et date conservées).
- [ ] Droit de rétractation de 14 jours : case « je demande l'accès immédiat et reconnais perdre mon droit de rétractation », ou remboursement au prorata.
- [ ] Résiliation « en 3 clics » depuis l'appli (portail client Stripe ou bouton dédié), bien visible.
- [ ] Prix affichés TTC.
- [ ] Factures émises par Stripe, avec la mention « TVA non applicable, art. 293 B du CGI » tant que l'activité est sous le seuil de franchise.
- [ ] Mentions légales : SIRET, adresse, médiateur.
- [ ] Politique de confidentialité : Stripe ajouté parmi les sous-traitants.
- [ ] Rédiger une première version des CGV (à faire relire).

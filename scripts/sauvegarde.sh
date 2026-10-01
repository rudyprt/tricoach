#!/usr/bin/env bash
#
# Sauvegarde de la base TriCoach.
#
# Rien ne protégeait les données : ni script, ni procédure. Une base perdue,
# c'est la totalité des comptes, des programmes et des historiques — et, sur
# des données de santé, un incident à notifier à la CNIL.
#
# Usage :
#   DATABASE_URL="postgresql://..." ./scripts/sauvegarde.sh [dossier]
#
# Le dossier vaut « sauvegardes » par défaut. Les copies de plus de
# RETENTION_JOURS jours sont effacées : une sauvegarde qu'on n'élague jamais
# finit par remplir le disque et échouer au pire moment.

set -euo pipefail

DOSSIER="${1:-sauvegardes}"
RETENTION_JOURS="${RETENTION_JOURS:-30}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL n'est pas défini." >&2
  echo "Récupérez la chaîne de connexion dans le tableau de bord de votre hébergeur." >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump est introuvable. Installez le client PostgreSQL (paquet postgresql-client)." >&2
  exit 1
fi

mkdir -p "$DOSSIER"
HORODATAGE="$(date -u +%Y%m%d-%H%M%S)"
FICHIER="$DOSSIER/tricoach-$HORODATAGE.sql.gz"

# --no-owner et --no-acl : la copie doit pouvoir être restaurée sur une base
# neuve, dont les rôles ne porteront pas les mêmes noms.
pg_dump "$DATABASE_URL" --no-owner --no-acl --clean --if-exists | gzip > "$FICHIER"

TAILLE=$(wc -c < "$FICHIER")
# Une archive vide ou minuscule signale un échec que pg_dump n'a pas signalé.
# Mieux vaut refuser la copie que la croire bonne jusqu'au jour de la panne.
if [ "$TAILLE" -lt 1024 ]; then
  echo "La sauvegarde ne fait que $TAILLE octets : elle est probablement vide." >&2
  rm -f "$FICHIER"
  exit 1
fi

# Vérifier que l'archive se relit : une copie corrompue ne se découvre
# autrement qu'au moment où l'on en a besoin.
if ! gzip -t "$FICHIER"; then
  echo "L'archive est illisible." >&2
  rm -f "$FICHIER"
  exit 1
fi

echo "Sauvegarde écrite : $FICHIER ($((TAILLE / 1024)) Ko)"

SUPPRIMEES=$(find "$DOSSIER" -name 'tricoach-*.sql.gz' -mtime "+$RETENTION_JOURS" -print -delete | wc -l)
if [ "$SUPPRIMEES" -gt 0 ]; then
  echo "$SUPPRIMEES sauvegarde(s) de plus de $RETENTION_JOURS jours supprimée(s)."
fi

echo
echo "Pour restaurer :"
echo "  gunzip -c $FICHIER | psql \"\$DATABASE_URL\""
echo
echo "Une sauvegarde jamais restaurée n'est pas une sauvegarde : faites l'essai"
echo "au moins une fois, sur une base de test."

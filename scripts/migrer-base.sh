#!/usr/bin/env bash
#
# Migration de la base TriCoach d'un hébergeur vers un autre.
#
# Écrite pour passer de la base Render à Neon, mais elle ne suppose rien de
# l'un ni de l'autre : deux chaînes de connexion suffisent.
#
# Usage :
#   SOURCE_DATABASE_URL="postgresql://..." \
#   CIBLE_DATABASE_URL="postgresql://..." \
#   ./scripts/migrer-base.sh
#
# La copie est conservée dans « sauvegardes/ » : c'est le seul filet si la
# bascule tourne mal, et il ne coûte rien de la garder.
#
# La base cible doit être vide. Migrer par-dessus des données existantes, c'est
# les écraser sans possibilité de retour — le script refuse plutôt que de
# demander confirmation à quelqu'un qui lit en diagonale.

set -euo pipefail

DOSSIER="${DOSSIER:-sauvegardes}"

manque() {
  echo "$1 n'est pas défini." >&2
  exit 1
}

[ -n "${SOURCE_DATABASE_URL:-}" ] || manque "SOURCE_DATABASE_URL"
[ -n "${CIBLE_DATABASE_URL:-}" ] || manque "CIBLE_DATABASE_URL"

if [ "$SOURCE_DATABASE_URL" = "$CIBLE_DATABASE_URL" ]; then
  echo "La source et la cible sont la même base." >&2
  exit 1
fi

for outil in pg_dump psql; do
  if ! command -v "$outil" >/dev/null 2>&1; then
    echo "$outil est introuvable. Installez le client PostgreSQL (paquet postgresql-client)." >&2
    exit 1
  fi
done

# Les tables du schéma applicatif, sans les tables système. Sert à constater que
# la cible est vide avant, et qu'elle contient la même chose après.
tables() {
  psql "$1" -At -c \
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
}

echo "→ Lecture de la base source"
if ! TABLES_SOURCE="$(tables "$SOURCE_DATABASE_URL")"; then
  echo "Connexion à la base source impossible." >&2
  exit 1
fi
if [ -z "$TABLES_SOURCE" ]; then
  echo "La base source ne contient aucune table : il n'y a rien à migrer." >&2
  exit 1
fi
echo "  $(echo "$TABLES_SOURCE" | wc -l) table(s) trouvée(s)."

echo "→ Vérification de la base cible"
if ! TABLES_CIBLE="$(tables "$CIBLE_DATABASE_URL")"; then
  echo "Connexion à la base cible impossible." >&2
  exit 1
fi
if [ -n "$TABLES_CIBLE" ]; then
  echo "La base cible n'est pas vide : elle contient déjà $(echo "$TABLES_CIBLE" | wc -l) table(s)." >&2
  echo "Migrer par-dessus écraserait ces données. Créez une base neuve." >&2
  exit 1
fi

mkdir -p "$DOSSIER"
HORODATAGE="$(date -u +%Y%m%d-%H%M%S)"
COPIE="$DOSSIER/migration-$HORODATAGE.sql"

# --no-owner et --no-acl : les rôles de l'hébergeur d'origine n'existent pas
# chez le nouveau, et la restauration échouerait à vouloir les attribuer.
echo "→ Copie de la base source"
pg_dump "$SOURCE_DATABASE_URL" --no-owner --no-acl > "$COPIE"

TAILLE=$(wc -c < "$COPIE")
if [ "$TAILLE" -lt 1024 ]; then
  echo "La copie ne fait que $TAILLE octets : elle est probablement vide." >&2
  rm -f "$COPIE"
  exit 1
fi
echo "  $((TAILLE / 1024)) Ko écrits dans $COPIE"

# --single-transaction avec ON_ERROR_STOP : la restauration passe entièrement ou
# ne laisse rien. Une base à moitié remplie serait pire que pas de base du tout,
# puisqu'elle passerait pour migrée.
echo "→ Restauration dans la base cible"
if ! psql "$CIBLE_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -q -o /dev/null -f "$COPIE"; then
  echo >&2
  echo "La restauration a échoué : la base cible est restée vide." >&2
  echo "La copie est conservée dans $COPIE." >&2
  exit 1
fi

# Comparer les tables une à une. C'est la seule preuve que rien n'est resté en
# route : une restauration « sans erreur » peut très bien n'avoir rien inséré.
echo "→ Vérification ligne par ligne"
ECARTS=0
while IFS= read -r table; do
  N_SOURCE=$(psql "$SOURCE_DATABASE_URL" -At -c "SELECT count(*) FROM \"$table\"")
  N_CIBLE=$(psql "$CIBLE_DATABASE_URL" -At -c "SELECT count(*) FROM \"$table\"" 2>/dev/null || echo "absente")
  if [ "$N_SOURCE" != "$N_CIBLE" ]; then
    printf '  %-28s %s → %s  ÉCART\n' "$table" "$N_SOURCE" "$N_CIBLE"
    ECARTS=$((ECARTS + 1))
  elif [ "$N_SOURCE" != "0" ]; then
    printf '  %-28s %s lignes\n' "$table" "$N_SOURCE"
  fi
done <<< "$TABLES_SOURCE"

if [ "$ECARTS" -gt 0 ]; then
  echo >&2
  echo "$ECARTS table(s) ne correspondent pas. NE BASCULEZ PAS : la base source" >&2
  echo "reste la bonne, et la copie est conservée dans $COPIE." >&2
  exit 1
fi

# Sans cette table, Prisma croirait la base neuve et rejouerait toutes les
# migrations sur des tables déjà créées, au premier démarrage du serveur.
if ! echo "$TABLES_SOURCE" | grep -qx "_prisma_migrations"; then
  echo >&2
  echo "Avertissement : la table _prisma_migrations est absente de la source." >&2
  echo "Le serveur rejouera ses migrations au démarrage. Vérifiez-le avant la bascule." >&2
fi

echo
echo "Migration terminée et vérifiée. La base source n'a pas été modifiée."
echo
echo "Il reste à basculer l'application :"
echo "  1. Chez votre hébergeur, remplacez DATABASE_URL par la chaîne de la nouvelle base."
echo "  2. Redéployez, puis connectez-vous pour vérifier qu'un compte existant fonctionne."
echo "  3. Ne supprimez l'ancienne base qu'après quelques jours sans incident."

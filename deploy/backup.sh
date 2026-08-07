#!/usr/bin/env bash
#
# rent_car backup — Postgres dump + uploads tarball, with retention.
#
# The uploads dir (signatures, generated/signed PDFs, attachments, outsource
# quotes) is NOT in the database, and booking rows reference those files by
# path — so a usable restore needs BOTH the DB dump and the uploads tarball
# from the same run. This script writes both, timestamped, and prunes old ones.
#
# Config (env; override in the systemd EnvironmentFile):
#   DATABASE_URL            required — the Postgres connection URI
#   UPLOADS_DIR             default /var/lib/rent_car/uploads
#   BACKUP_DIR              default /var/backups/rent_car
#   BACKUP_RETENTION_DAYS   default 14
#
# Restore (into an EMPTY db + the uploads parent dir):
#   gunzip -c db-<ts>.sql.gz | psql "${DATABASE_URL%%\?*}"   # strip Prisma's ?schema=
#   tar -xzf uploads-<ts>.tar.gz -C "$(dirname "$UPLOADS_DIR")"

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/rent_car/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/rent_car}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

ts="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 1. Database (schema + data). Dump to a temp name, rename on success so a
#    partial dump never looks like a good backup.
#
#    Prisma URLs carry a `?schema=public` param that libpq's pg_dump rejects —
#    strip just that param (keep sslmode etc.). public is pg_dump's default, so
#    dropping it changes nothing.
dump_url="$(printf '%s' "$DATABASE_URL" | sed -E 's/\?schema=[^&]*&/?/; s/[?&]schema=[^&]*//')"
db_tmp="$BACKUP_DIR/.db-$ts.sql.gz.partial"
pg_dump "$dump_url" | gzip -9 > "$db_tmp"
mv "$db_tmp" "$BACKUP_DIR/db-$ts.sql.gz"

# 2. Uploads.
if [ -d "$UPLOADS_DIR" ]; then
  up_tmp="$BACKUP_DIR/.uploads-$ts.tar.gz.partial"
  tar -czf "$up_tmp" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
  mv "$up_tmp" "$BACKUP_DIR/uploads-$ts.tar.gz"
  uploads_note=", uploads-$ts.tar.gz"
else
  # Hard failure, not a warning: booking rows reference files on disk, so a dump
  # without them is not a restorable backup. Exiting 0 here made the nightly unit
  # report success while silently backing up nothing — the worst possible outcome
  # for a backup. If UPLOADS_DIR is genuinely unset, set it in /etc/rent_car.env.
  echo "FATAL: UPLOADS_DIR '$UPLOADS_DIR' not found — refusing to report a partial backup as success" >&2
  exit 1
  uploads_note=" (no uploads dir)"
fi

# 3. Retention — drop backups older than RETENTION_DAYS.
find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.sql.gz'      -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'uploads-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

echo "backup ok: $BACKUP_DIR/db-$ts.sql.gz$uploads_note (retention ${RETENTION_DAYS}d)"

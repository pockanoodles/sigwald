#!/bin/sh
# The compose `backup` service: one database copy a day into /backups (the
# ./backups folder next to docker-compose.yml), checked with pg_restore --list
# before it counts, keeping the newest SIGWALD_BACKUP_KEEP (14 by default).
# The copies are on the same disk as the database, so copy the folder off the
# machine now and then; SIGWALD_SECRET_KEY has to travel with them.
#
# Connection comes from PGHOST, PGUSER, PGPASSWORD and PGDATABASE.
set -eu
# The dumps hold every user's data, so only their owner may read them: the
# script runs as root, and root's default umask would leave them 0644 on the host.
umask 077

KEEP="${SIGWALD_BACKUP_KEEP:-14}"
DIR="${SIGWALD_BACKUP_DIR:-/backups}"

backup_once() {
  today="$(date -u +%F)"
  final="$DIR/sigwald-$today.dump"
  [ -s "$final" ] && return 0

  tmp="$DIR/.sigwald-$today.dump.partial"
  rm -f "$tmp"
  if ! pg_dump -Fc -f "$tmp"; then
    echo "backup: pg_dump failed; trying again in an hour" >&2
    rm -f "$tmp"
    return 1
  fi
  if ! pg_restore --list "$tmp" >/dev/null; then
    echo "backup: $tmp doesn't read back; trying again in an hour" >&2
    rm -f "$tmp"
    return 1
  fi
  mv "$tmp" "$final"
  echo "backup: wrote $final ($(wc -c <"$final" | tr -d " ") bytes)"

  # Newest first by name (the date), drop everything past KEEP.
  ls -1 "$DIR"/sigwald-*.dump 2>/dev/null | sort -r | tail -n +"$((KEEP + 1))" | while read -r old; do
    rm -f "$old" && echo "backup: removed $old"
  done
}

mkdir -p "$DIR"
while :; do
  backup_once || true
  sleep 3600
done

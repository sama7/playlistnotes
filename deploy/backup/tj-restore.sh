#!/usr/bin/env bash
#
# Restore a TrackJot backup — into a scratch database by default.
#
# A backup nobody has restored is a hypothesis, not a backup. This is the other
# half of tj-backup.sh and it is meant to be *run*, not just to exist: the
# rehearsal is what turns "we take backups" into a claim that survives contact
# with an actual outage.
#
# It refuses to write to the live database unless TJ_ALLOW_LIVE=yes is set
# explicitly. Restoring over production is a decision someone should have to
# make on purpose, at 3am, while tired.
#
# Usage:
#   tj-restore.sh /var/backups/trackjot/daily/tj-<date>.sql.gz.enc
#   tj-restore.sh <archive> trackjot_restore_check

set -euo pipefail

ARCHIVE="${1:?usage: tj-restore.sh <encrypted-archive> [target-database]}"
TARGET="${2:-trackjot_restore_check}"
PASS_FILE="${TJ_PASS_FILE:-/root/.tj-db-backup-pass}"

if [ "$TARGET" = "trackjot" ] && [ "${TJ_ALLOW_LIVE:-no}" != "yes" ]; then
  echo "Refusing to restore over the live database. Re-run with TJ_ALLOW_LIVE=yes if that is genuinely what you want." >&2
  exit 1
fi

[ -r "$ARCHIVE" ] || { echo "cannot read $ARCHIVE" >&2; exit 1; }
[ -r "$PASS_FILE" ] || { echo "cannot read $PASS_FILE" >&2; exit 1; }

PLAIN="$(mktemp /tmp/tj-restore-XXXXXX.sql)"

# Decrypt and decompress as two checked steps rather than one pipe. A wrong
# passphrase otherwise surfaces as "gzip: stdin: not in gzip format", which
# sends whoever is restoring at 3am after the wrong problem.
GZ="$(mktemp /tmp/tj-restore-XXXXXX.sql.gz)"
trap 'rm -f "$PLAIN" "$GZ"' EXIT

if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$PASS_FILE" \
     -in "$ARCHIVE" -out "$GZ" 2>/dev/null; then
  echo "Could not decrypt $ARCHIVE. The passphrase in $PASS_FILE does not match this archive." >&2
  exit 1
fi

gzip -dc "$GZ" >"$PLAIN" || { echo "Decrypted, but the archive is not valid gzip." >&2; exit 1; }

tail -n 5 "$PLAIN" | grep -q 'PostgreSQL database dump complete' || {
  echo "Decrypted output is not a complete pg_dump — the archive is truncated or corrupt." >&2
  exit 1
}

sudo -u postgres dropdb --if-exists "$TARGET"
sudo -u postgres createdb -O trackjot "$TARGET"
# Fed on stdin rather than with -f: the dump lives in a 0600 root-owned temp
# file, which the postgres user cannot open. The redirection happens in this
# shell, so psql inherits an already-open descriptor and never needs the path.
sudo -u postgres psql --quiet --set ON_ERROR_STOP=1 -d "$TARGET" >/dev/null <"$PLAIN"

echo "Restored $ARCHIVE into $TARGET"
sudo -u postgres psql -Atd "$TARGET" -c "
  select 'tables=' || count(*) from information_schema.tables where table_schema='public';
"
sudo -u postgres psql -Atd "$TARGET" -c "
  select 'users=' || (select count(*) from users)
      || ' recordings=' || (select count(*) from recordings)
      || ' notes=' || (select count(*) from notes)
      || ' collections=' || (select count(*) from collections);
"

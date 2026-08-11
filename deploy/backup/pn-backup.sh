#!/usr/bin/env bash
#
# Hourly encrypted backup of the Playlistnotes database.
#
# This exists because Managed PostgreSQL was rejected on cost. That was a
# reasonable trade for a product with no users, but it means the automated
# backups and point-in-time recovery a managed service would have provided have
# to be built — and the database currently lives on the same droplet as the
# application and as MKDb, so a lost droplet is a lost product without this.
#
# Design decisions worth stating:
#
#   - **Encrypt before the data leaves the box.** The archive is encrypted on
#     the droplet and only the ciphertext is uploaded. The storage provider is
#     never trusted with note bodies.
#   - **Fail loudly and early.** `set -euo pipefail` plus an explicit pipe check,
#     because a backup that silently produces a 0-byte file is worse than none:
#     it looks like protection.
#   - **The dump is verified before it is kept.** A truncated dump that still
#     exits zero is the classic way this goes wrong, so the plaintext is checked
#     for pg_dump's own terminator before it is encrypted.
#   - **Never touch MKDb.** Only the `playlistnotes` database is read.
#
# Install: /usr/local/bin/pn-backup.sh, mode 0755, run hourly from cron.

set -euo pipefail

DB_NAME="${PN_DB_NAME:-playlistnotes}"
DB_USER="${PN_DB_USER:-playlistnotes}"
BACKUP_DIR="${PN_BACKUP_DIR:-/var/backups/playlistnotes}"
PASS_FILE="${PN_PASS_FILE:-/root/.pn-db-backup-pass}"
LOG_FILE="${PN_LOG_FILE:-/var/log/pn-backup.log}"
STATUS_FILE="${PN_STATUS_FILE:-/var/lib/pn-backup/last-status}"

# Set to an rclone remote:path once Drive is configured, e.g. "pndrive:playlistnotes-backups".
RCLONE_DEST="${PN_RCLONE_DEST:-}"

HOURLY_KEEP="${PN_HOURLY_KEEP:-24}"
DAILY_KEEP="${PN_DAILY_KEEP:-30}"

timestamp() { date -u +%Y%m%dT%H%M%SZ; }
log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG_FILE"; }

mkdir -p "$BACKUP_DIR/hourly" "$BACKUP_DIR/daily" "$(dirname "$STATUS_FILE")"
touch "$LOG_FILE"

fail() {
  log "FAILED: $*"
  printf 'FAILED %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >"$STATUS_FILE"
  exit 1
}

[ -r "$PASS_FILE" ] || fail "passphrase file $PASS_FILE is missing or unreadable"

TS="$(timestamp)"
PLAIN="$(mktemp /tmp/pn-dump-XXXXXX.sql)"
# The plaintext dump is the one moment note bodies exist unencrypted on disk.
# Remove it on every exit path, including failure.
trap 'rm -f "$PLAIN"' EXIT

sudo -u postgres pg_dump --no-owner --no-privileges --format=plain "$DB_NAME" >"$PLAIN" \
  || fail "pg_dump exited non-zero"

# pg_dump writes this as its final line. Its absence means truncation, which an
# exit code alone would not catch.
tail -n 5 "$PLAIN" | grep -q 'PostgreSQL database dump complete' \
  || fail "dump is truncated — refusing to keep it"

BYTES="$(wc -c <"$PLAIN")"
[ "$BYTES" -gt 512 ] || fail "dump is implausibly small (${BYTES} bytes)"

OUT="$BACKUP_DIR/hourly/pn-${TS}.sql.gz.enc"
gzip -c "$PLAIN" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$PASS_FILE" \
  >"$OUT" || fail "encryption failed"

chmod 600 "$OUT"

# One promoted copy per UTC day, so a slow-burn corruption discovered next week
# is still recoverable.
DAY="${TS%%T*}"
DAILY="$BACKUP_DIR/daily/pn-${DAY}.sql.gz.enc"
[ -e "$DAILY" ] || cp -p "$OUT" "$DAILY"

# Retention. `ls -t` newest-first, keep the head, delete the tail.
prune() {
  local dir="$1" keep="$2"
  ( cd "$dir" && ls -t 2>/dev/null | tail -n "+$((keep + 1))" | xargs -r rm -f )
}
prune "$BACKUP_DIR/hourly" "$HOURLY_KEEP"
prune "$BACKUP_DIR/daily" "$DAILY_KEEP"

UPLOADED="no (off-host copy not configured)"
if [ -n "$RCLONE_DEST" ] && command -v rclone >/dev/null 2>&1; then
  # Mirror both tiers. Only ciphertext crosses the wire.
  rclone copy "$BACKUP_DIR/hourly" "$RCLONE_DEST/hourly" --quiet \
    && rclone copy "$BACKUP_DIR/daily" "$RCLONE_DEST/daily" --quiet \
    && rclone delete "$RCLONE_DEST/hourly" --min-age "$((HOURLY_KEEP))h" --quiet \
    || fail "rclone upload failed"
  UPLOADED="yes -> $RCLONE_DEST"
fi

log "OK ${OUT} ($(wc -c <"$OUT") bytes encrypted, ${BYTES} plain) uploaded=${UPLOADED}"
printf 'OK %s %s uploaded=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$OUT" "$UPLOADED" >"$STATUS_FILE"

# An on-droplet-only backup protects against a bad migration or a dropped table,
# which is real but partial. It does NOT survive losing the droplet, so say so
# on every run rather than letting the absence look like success.
if [ -z "$RCLONE_DEST" ]; then
  log "WARNING: backups are on the same droplet as the database. Configure PN_RCLONE_DEST for off-host copies."
fi

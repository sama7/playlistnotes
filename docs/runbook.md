# Runbook

Operational procedures for TrackJot v2 on the DigitalOcean droplet.

The droplet also runs **MKDb** — pm2 `server` and `mankbot`, nginx on port 3000,
its own PostgreSQL databases, its own certificate, and a weekly crontab. **None
of it is ever modified.** Everything below touches only TrackJot-owned
processes, files, databases, and vhosts.

---

## Layout

| Thing | Where |
| --- | --- |
| Application | `/srv/trackjot/current`, pm2 process `trackjot` |
| Entry point | `scripts/start-standalone.cjs` — **never `server.js` directly** |
| Node | `/opt/node24` (isolated; the system Node stays 18.19.1 for MKDb) |
| Port | `127.0.0.1:3001`, reachable only through nginx |
| nginx vhost | `/etc/nginx/sites-available/trackjot.com` |
| Certificate | Let's Encrypt, `trackjot.com` + `www.trackjot.com`, auto-renewing |
| Database | droplet-local PostgreSQL 16, database and role both `trackjot` |
| Backups | `/var/backups/trackjot/{hourly,daily}` |
| Backup log | `/var/log/tj-backup.log`, last result in `/var/lib/tj-backup/last-status` |

## Deploying

CI builds the artifact; the droplet only runs it. From a clean checkout:

```bash
npm run build
# package: .next/standalone + .next/static + public + scripts/ + prisma/
rsync -az --delete --exclude '.env' artifact/ root@<droplet>:/srv/trackjot/current/
ssh root@<droplet> 'cd /srv/trackjot/current && /opt/node24/bin/node scripts/check-env.mjs .env'
ssh root@<droplet> 'cd /srv/trackjot/current && npx prisma migrate deploy'
ssh root@<droplet> 'pm2 restart trackjot --update-env'
ssh root@<droplet> 'cd /srv/trackjot/current && /opt/node24/bin/node scripts/smoke.js https://trackjot.com'
```

`check-env.mjs` validates the **shape** of every configured secret and never
prints a value. It exists because of a failure neither the build nor the smoke
test could see: the first deployment copied secrets with `grep`, which is
line-based, so the multi-line Apple private key arrived truncated — a BEGIN
marker, no END, 94 of 261 bytes. The app started, served every page, passed
every check, and Apple Music was quietly broken, because the failure only
surfaces inside a signing call no anonymous request makes. A secret can be
present and wrong, and presence is all an "is it set?" check ever proves.

**Never copy a multi-line secret with `grep` or line-based tools.** Extract the
whole value and pipe it over ssh without displaying it.

`--exclude '.env'` matters: the environment file lives on the droplet at mode
0600 and must never be overwritten by a deploy or copied into the repository.

**Always finish with the smoke check.** A green build and a running process
proved nothing on 2026-08-10 — every rendering route hung for 30 seconds while
pm2 reported `online`.

### Why the entry point is a wrapper

`scripts/start-standalone.cjs` sets `HOSTNAME=localhost` and forces IPv4-first
DNS. Both are required together, and the reasoning is in the file's header. If
the app is ever started with `HOSTNAME=127.0.0.1`, Next proxies every rendering
request to itself and each one hangs for 30 seconds before a 500.

## Backups

Hourly, from `/etc/cron.d/trackjot-backup` at 17 past. Each run dumps the
`trackjot` database, verifies the dump is complete rather than truncated,
gzips it, and encrypts it with AES-256 **before** anything leaves the box. One
copy per UTC day is promoted to `daily/`. Retention is 24 hourly and 30 daily.

```bash
/usr/local/bin/tj-backup.sh          # run one now
cat /var/lib/tj-backup/last-status   # OK/FAILED, timestamp, destination
tail -20 /var/log/tj-backup.log
```

### Restoring

```bash
# Rehearsal — restores into a scratch database, never the live one.
/usr/local/bin/tj-restore.sh /var/backups/trackjot/daily/tj-<date>.sql.gz.enc

# Real recovery, deliberately awkward:
TJ_ALLOW_LIVE=yes /usr/local/bin/tj-restore.sh <archive> trackjot
```

The script refuses to write to `trackjot` without `TJ_ALLOW_LIVE=yes`,
because restoring over production is a decision someone should make on purpose
at 3am while tired.

**Rehearsed 2026-08-11.** A probe row was written, backed up, and recovered into
a scratch database: 17 tables, probe row present. A wrong passphrase was
confirmed to fail with a clear message rather than half-restoring, and the
ciphertext was confirmed to contain no readable SQL.

### Off-host copies — configured 2026-08-11

Backups are mirrored to Google Drive on the `trackjotapp@gmail.com`
account, remote `tjdrive`, path `trackjot-backups/{hourly,daily}`.
`TJ_RCLONE_DEST` is set in `/etc/cron.d/trackjot-backup`, so every
scheduled run uploads. Only ciphertext crosses the wire — Drive never holds a
readable note body.

Two details worth keeping:

- **The remote uses its own Google OAuth client_id and secret, not rclone's
  shared one.** rclone now warns that the shared client_id is being retired
  during 2026; a remote built on it would have stopped working mid-year with a
  confusing auth error. Ours is independent of that deadline.
- **Scope is `drive.file`**, not full `drive`. rclone can only see and modify
  files it created, so a compromised droplet cannot read or delete the rest of
  that account's Drive.

The browser half of OAuth was done on a laptop and the resulting config piped
straight into the droplet over ssh, so the refresh token was never displayed or
stored anywhere else:

```bash
rclone config show tjdrive | ssh root@<droplet> 'cat >> /root/.config/rclone/rclone.conf'
```

**Round trip rehearsed 2026-08-11.** A probe row was written to the live
database, backed up, encrypted, uploaded, then downloaded from Drive into a
directory holding no other copy, decrypted, and restored into a scratch
database — probe row present, 17 tables. That is the whole chain, not just the
upload.

```bash
rclone about tjdrive:                              # quota
rclone ls tjdrive:trackjot-backups            # what is actually stored
rclone lsf tjdrive:trackjot-backups/hourly | sort | tail -1
```

### The passphrase stays on the droplet

`/root/.tj-db-backup-pass`, mode 0600 — renamed from `.pn-db-backup-pass` on
2026-08-13; the passphrase itself is unchanged, so the copy in the password
manager is still correct. **It is not to be deleted** — the hourly
job reads it on every run, and the script fails closed without it.

A second copy lives in the owner's password manager, which was the part that
mattered: the risk was ever having exactly one copy, sitting next to the
backups it decrypts. Do not confuse this with the v1 disaster-recovery
passphrase, which encrypted a single one-off artifact and was correctly deleted
from disk once saved.

## TLS

Certbot renews automatically via its systemd timer. To check:

```bash
certbot certificates
certbot renew --dry-run
```

The vhost is certbot-managed. Do not hand-edit the `# managed by Certbot` lines;
change things through certbot and re-pull the file into `deploy/nginx/`.

`v2.playlistnotes.io` was retired on 2026-08-12 — vhost and certificate deleted.
It was briefly kept as a redirect on the principle that share links are durable,
which turned out not to apply: there were no users, no notes and no links in the
wild. Its GoDaddy A record is harmless and can be removed whenever convenient.

## Health

```bash
curl -s https://trackjot.com/api/health     # {"status":"ok"}
pm2 status
free -h                                            # 2 GB shared with MKDb
curl -s -o /dev/null -w '%{http_code}\n' https://mkdb.co/   # must stay 200
```

`/api/health` runs `SELECT 1`, so it returns 503 when the process is up but the
database is unreachable — the state a bare 200 would hide.

## If the site is down

1. `pm2 status` — is `trackjot` online?
2. `pm2 logs trackjot --lines 50`
3. `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/health` —
   isolates nginx from the app.
4. `nginx -t && systemctl status nginx`
5. `free -h` — the box is 2 GB and shared. The OOM killer is a real suspect;
   check `dmesg -T | grep -i oom`.
6. Roll back by rsyncing the previous artifact and restarting. The database is
   only rolled back deliberately, via the restore procedure above.

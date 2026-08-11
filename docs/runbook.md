# Runbook

Operational procedures for Playlistnotes v2 on the DigitalOcean droplet.

The droplet also runs **MKDb** — pm2 `server` and `mankbot`, nginx on port 3000,
its own PostgreSQL databases, its own certificate, and a weekly crontab. **None
of it is ever modified.** Everything below touches only Playlistnotes-owned
processes, files, databases, and vhosts.

---

## Layout

| Thing | Where |
| --- | --- |
| Application | `/srv/playlistnotes/current`, pm2 process `playlistnotes` |
| Entry point | `scripts/start-standalone.cjs` — **never `server.js` directly** |
| Node | `/opt/node24` (isolated; the system Node stays 18.19.1 for MKDb) |
| Port | `127.0.0.1:3001`, reachable only through nginx |
| nginx vhost | `/etc/nginx/sites-available/v2.playlistnotes.io` |
| Certificate | Let's Encrypt, `v2.playlistnotes.io`, auto-renewing |
| Database | droplet-local PostgreSQL 16, database and role both `playlistnotes` |
| Backups | `/var/backups/playlistnotes/{hourly,daily}` |
| Backup log | `/var/log/pn-backup.log`, last result in `/var/lib/pn-backup/last-status` |

## Deploying

CI builds the artifact; the droplet only runs it. From a clean checkout:

```bash
npm run build
# package: .next/standalone + .next/static + public + scripts/ + prisma/
rsync -az --delete --exclude '.env' artifact/ root@<droplet>:/srv/playlistnotes/current/
ssh root@<droplet> 'cd /srv/playlistnotes/current && npx prisma migrate deploy'
ssh root@<droplet> 'pm2 restart playlistnotes --update-env'
ssh root@<droplet> 'cd /srv/playlistnotes/current && /opt/node24/bin/node scripts/smoke.js https://v2.playlistnotes.io'
```

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

Hourly, from `/etc/cron.d/playlistnotes-backup` at 17 past. Each run dumps the
`playlistnotes` database, verifies the dump is complete rather than truncated,
gzips it, and encrypts it with AES-256 **before** anything leaves the box. One
copy per UTC day is promoted to `daily/`. Retention is 24 hourly and 30 daily.

```bash
/usr/local/bin/pn-backup.sh          # run one now
cat /var/lib/pn-backup/last-status   # OK/FAILED, timestamp, destination
tail -20 /var/log/pn-backup.log
```

### Restoring

```bash
# Rehearsal — restores into a scratch database, never the live one.
/usr/local/bin/pn-restore.sh /var/backups/playlistnotes/daily/pn-<date>.sql.gz.enc

# Real recovery, deliberately awkward:
PN_ALLOW_LIVE=yes /usr/local/bin/pn-restore.sh <archive> playlistnotes
```

The script refuses to write to `playlistnotes` without `PN_ALLOW_LIVE=yes`,
because restoring over production is a decision someone should make on purpose
at 3am while tired.

**Rehearsed 2026-08-11.** A probe row was written, backed up, and recovered into
a scratch database: 17 tables, probe row present. A wrong passphrase was
confirmed to fail with a clear message rather than half-restoring, and the
ciphertext was confirmed to contain no readable SQL.

### Two things only the account owner can do

1. **Copy the passphrase off the droplet.** It is at `/root/.pn-db-backup-pass`,
   mode 0600, and was generated on the box so it has never appeared in a
   transcript. **Right now it exists in exactly one place, which is the same
   place as the backups it decrypts** — so losing the droplet loses both.
   ```bash
   ssh root@<droplet> 'cat /root/.pn-db-backup-pass'
   ```
   Put it in the password manager. Without it every archive is scrap.

2. **Configure the off-host copy.** Until then backups sit on the same droplet
   as the database, which protects against a bad migration or a dropped table
   but not against losing the droplet. The script logs a warning on every run
   saying exactly that.
   ```bash
   apt-get install -y rclone
   rclone config           # new remote "pndrive", type drive, the playlistnotesapp account
   rclone mkdir pndrive:playlistnotes-backups
   # then add to /etc/cron.d/playlistnotes-backup:
   #   PN_RCLONE_DEST=pndrive:playlistnotes-backups
   ```
   Only ciphertext is uploaded; Drive never holds a readable note body. 15 GB
   is ample — the archives are kilobytes at current size.

## TLS

Certbot renews automatically via its systemd timer. To check:

```bash
certbot certificates
certbot renew --dry-run
```

The vhost is certbot-managed. Do not hand-edit the `# managed by Certbot` lines;
change things through certbot and re-pull the file into `deploy/nginx/`.

## Health

```bash
curl -s https://v2.playlistnotes.io/api/health     # {"status":"ok"}
pm2 status
free -h                                            # 2 GB shared with MKDb
curl -s -o /dev/null -w '%{http_code}\n' https://mkdb.co/   # must stay 200
```

`/api/health` runs `SELECT 1`, so it returns 503 when the process is up but the
database is unreachable — the state a bare 200 would hide.

## If the site is down

1. `pm2 status` — is `playlistnotes` online?
2. `pm2 logs playlistnotes --lines 50`
3. `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/health` —
   isolates nginx from the app.
4. `nginx -t && systemctl status nginx`
5. `free -h` — the box is 2 GB and shared. The OOM killer is a real suspect;
   check `dmesg -T | grep -i oom`.
6. Roll back by rsyncing the previous artifact and restarting. The database is
   only rolled back deliberately, via the restore procedure above.

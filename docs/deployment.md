# Deployment — nginx + Linux server (self-hosted)

Target: a single Linux box running the Next.js app (Node) behind nginx, with
Postgres alongside. Uploads live on local disk (fine on one persistent host).

## 0. The one thing that WILL break scheduling if you skip it

**Set `TZ=Asia/Bangkok` in the app's process environment.** `runBatchAction`
(จัดรอบ) and `lib/booking/trip-legs.ts` compute day boundaries and no-wait leg
splits in *server-local* time. A default-UTC host assigns bookings to the wrong
day and splits legs at the wrong hour. The systemd unit below sets it. In **production the app refuses to start** on a
wrong zone — `instrumentation.ts` throws `[TZ FATAL]` — so a bad TZ shows up as a
service that will not come up, not as a warning you might miss. (In dev it only
warns, so a non-Bangkok laptop still runs.)

**Set the HOST clock too**, not just the app process:
```bash
sudo timedatectl set-timezone Asia/Bangkok
```
systemd resolves every `OnCalendar=` against the *host* zone, so the nightly
จัดรอบ and backup timers fire at the wrong hour on a default-UTC box even when
the app's own TZ is correct.

## 1. Prerequisites
- Node 20 (pin 20.x), npm.
- PostgreSQL 16 (native package or Docker; the repo ships `docker-compose.yml`
  for a container if you prefer).
- nginx.
- A Linux user to own the app (e.g. `rentcar`).

Create the service user and the database role/database before anything below
touches them — every later step runs as `rentcar` or connects as it:
```bash
# service user (no login shell, owns /opt/rent_car and the uploads dir)
sudo useradd --system --create-home --shell /usr/sbin/nologin rentcar

# native Postgres: role + database owned by it
sudo -u postgres createuser --pwprompt rentcar      # prompts for the <pw> used in DATABASE_URL
sudo -u postgres createdb --owner=rentcar rent_car
```
(Using the shipped `docker-compose.yml` instead? See the Docker DB role note in
§4 — the compose file creates only the `postgres` superuser.)

## 2. Get the code + build
```bash
sudo mkdir -p /opt/rent_car && sudo chown rentcar:rentcar /opt/rent_car
sudo -u rentcar git clone <repo> /opt/rent_car
cd /opt/rent_car
sudo -u rentcar npm ci
```

## 3. Environment file
Create `/etc/rent_car.env`. It holds `AUTH_SECRET` and the DB password, so it is
readable **only** by the service user:
```bash
sudo install -o rentcar -g rentcar -m 600 /dev/null /etc/rent_car.env
sudo -u rentcar editor /etc/rent_car.env
```
Owned by `rentcar` rather than root, because §4/§5 `source` this file to get
`DATABASE_URL` — root-owned `600` would be unreadable to the very commands that
need it. Minimum:
```
DATABASE_URL=postgresql://rentcar:<pw>@127.0.0.1:5432/rent_car?schema=public
AUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=https://booking.example.ac.th
APP_URL=https://booking.example.ac.th
UPLOADS_DIR=/var/lib/rent_car/uploads
```
Optional (features stay dormant without them):
```
RESEND_API_KEY=<key>               # WITHOUT THIS NO EMAIL IS EVER SENT — see below
EMAIL_FROM="ระบบจองรถ <noreply@booking.example.ac.th>"
DRIVER_STATION_EMAILS=driverstation@chula.ac.th   # the shared kiosk account(s)
CRON_SECRET=<openssl rand -hex 32>  # enables the daily จัดรอบ auto-run route
GOOGLE_MAPS_API_KEY=...            # enables the "Estimate distance" button
FACULTY_ORIGIN=คณะแพทยศาสตร์ จุฬาลงกรณ์มหาวิทยาลัย   # Maps distance origin override
# ENABLE_SIMULATION=true          # show the /admin/simulate debug tool in prod (default: hidden)
# PUBLIC_BASE_URL=https://...      # redundant override for links in emails; APP_URL already covers it
# LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET
#   Read only by the /api/line/webhook route. Nothing in the app currently SENDS
#   a LINE message — lib/line/client.ts has no caller — so leaving these unset
#   costs you nothing. Do not let the README's mention of LINE suggest otherwise.
```
> **`RESEND_API_KEY` is only "optional" in the sense that the app still boots.**
> Without it `sendEmail` silently degrades to a `console.log` stub: approval and
> assignment notices are never delivered, and **password-reset links are printed
> into the systemd journal instead of being emailed** — which is both a broken
> recovery path and a secret in your logs. Set it, or accept that the only
> self-service password recovery does not work.

> **`UPLOADS_DIR` is not optional either.** Unset, the app writes to
> `<install dir>/uploads` while `deploy/backup.sh` looks in
> `/var/lib/rent_car/uploads` — your backups would quietly contain no uploads.

Create the uploads dir: `sudo mkdir -p /var/lib/rent_car/uploads && sudo chown rentcar /var/lib/rent_car/uploads`.
It holds signatures, generated PDFs, and attachments — **back it up**;
it is not in the database.

## 4. Database

**Postgres in Docker (optional).** If you run the DB via the shipped
`docker-compose.yml` instead of a native package: set a real `POSTGRES_PASSWORD`
first (in a `.env` next to the compose file, or exported), then
`docker compose up -d`. The compose file binds Postgres to **127.0.0.1** only —
reachable from the on-box app, never the network. Point `DATABASE_URL` at
`127.0.0.1:5432` with a **password that matches** `POSTGRES_PASSWORD`. The app
still runs natively via systemd — only the DB is containerized.

```bash
# first deploy: migrate + seed the fleet/roster.
# systemd loads /etc/rent_car.env at runtime, but these first-deploy commands run
# outside systemd — source it so DATABASE_URL is set (else --preserve-env=DATABASE_URL
# preserves an unset var and migrate/seed fails to connect).
cd /opt/rent_car
set -a; source /etc/rent_car.env; set +a
sudo -u rentcar --preserve-env=DATABASE_URL npx prisma migrate deploy
sudo -u rentcar --preserve-env=DATABASE_URL npx prisma db seed   # first time only
```

> **Docker DB role:** the shipped `docker-compose.yml` creates the **`postgres`**
> superuser (its default), but the `DATABASE_URL` above uses role **`rentcar`**. If
> you run the DB via that compose file, either create the role once
> (`docker compose exec postgres psql -U postgres -c "CREATE ROLE rentcar LOGIN PASSWORD '<pw>' SUPERUSER;"`)
> or use `postgres` as the role in `DATABASE_URL`. A native Postgres install where
> you created a `rentcar` role needs neither.
> **Capture the seeded password — it is shown once.** `prisma db seed` generates
> a random temporary password for the admin, requester, kiosk and driver
> accounts and prints it when it finishes. It is not stored anywhere and cannot
> be recovered afterwards; if you lose it, re-run the seed. Every account is
> flagged `mustChangePassword`, so the first sign-in forces a real one. Set
> `SEED_PASSWORD` in the environment first if you would rather choose it.

`npm run build` also runs `prisma migrate deploy`, so subsequent deploys apply
new migrations automatically. **Never** run `migrate reset` / `db push
--force-reset` on prod.

## 5. Build + run
```bash
cd /opt/rent_car
set -a; source /etc/rent_car.env; set +a   # DATABASE_URL for the migrate step in build
sudo -u rentcar --preserve-env TZ=Asia/Bangkok npm run build   # migrate deploy + next build
```
Install the service (`deploy/rent-car.service.sample` → `/etc/systemd/system/rent-car.service`):
```bash
sudo cp deploy/rent-car.service.sample /etc/systemd/system/rent-car.service
# edit User / WorkingDirectory if not rentcar:/opt/rent_car
sudo systemctl daemon-reload
sudo systemctl enable --now rent-car
journalctl -u rent-car -f      # must reach "ready"; a wrong TZ aborts with [TZ FATAL]
```

## 6. nginx
`deploy/nginx.conf.sample` → `/etc/nginx/sites-available/rent_car`. Edit
`server_name` + TLS cert paths (use certbot/Let's Encrypt). Key detail:
`client_max_body_size 12m` so file uploads (10 MB cap in-app) aren't 413'd by
nginx first.
Issue the certificate **first** — the sample hardcodes
`/etc/letsencrypt/live/...` paths, so `nginx -t` fails while they do not exist:
```bash
sudo certbot --nginx -d booking.example.ac.th   # obtains the cert and reloads nginx
sudo ln -s /etc/nginx/sites-available/rent_car /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 7. Firewall (ufw)
The loopback binds (app on `127.0.0.1:3000`, Postgres on `127.0.0.1:5432`)
already keep those ports off the network. A firewall is belt-and-suspenders — it
closes anything you didn't explicitly open.

**Allow SSH BEFORE enabling, or you lock yourself out of the box.**
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH        # do this FIRST (or `sudo ufw allow 22/tcp`)
sudo ufw allow 80/tcp         # nginx HTTP (redirects to HTTPS)
sudo ufw allow 443/tcp        # nginx HTTPS
sudo ufw enable               # answer 'y' — the existing SSH session survives
sudo ufw status verbose       # confirm only 22/80/443 allowed, rest denied
```
Do **not** open 3000 or 5432 — they must stay loopback-only. If you SSH on a
non-standard port, `sudo ufw allow <port>/tcp` for it instead of `OpenSSH`.

## 8. Upgrades (each deploy)
```bash
cd /opt/rent_car
sudo -u rentcar git pull
sudo -u rentcar npm ci
set -a; source /etc/rent_car.env; set +a   # build runs `prisma migrate deploy` — it needs DATABASE_URL
sudo -u rentcar --preserve-env TZ=Asia/Bangkok npm run build   # applies new migrations
sudo systemctl restart rent-car
```
Restart is required after any migration — the running process caches the Prisma
client, so new columns 500 until restart.

## จัดรอบ (round-scheduling) — manual button + daily auto-run

Both paths run the same solver; they're idempotent (only touch APPROVED,
still-unassigned bookings), so they safely coexist.

**Manual** — an admin opens **/admin/batch**, picks a day, clicks **Run**.
TJW is assigned by request order separately (still manual).

**Daily auto-run** — a systemd timer POSTs to `/api/cron/run-batch` each
evening, assigning **tomorrow's** OT/WERN/NORMAL rounds so the board is set the
night before. To enable:
1. Set `CRON_SECRET` in `/etc/rent_car.env` (a long random string).
2. Install the timer + oneshot service:
   ```bash
   sudo cp deploy/rent-car-batch.service.sample /etc/systemd/system/rent-car-batch.service
   sudo cp deploy/rent-car-batch.timer.sample   /etc/systemd/system/rent-car-batch.timer
   # edit the host + confirm EnvironmentFile in the .service
   sudo systemctl daemon-reload && sudo systemctl enable --now rent-car-batch.timer
   systemctl list-timers rent-car-batch.timer     # confirm next run
   ```
The route fails closed: no `CRON_SECRET` → 503; wrong bearer → 401. It attributes
the run to an active admin in the audit log. Override the target day for a manual
re-run: `POST /api/cron/run-batch?date=YYYY-MM-DD`.

**Correctness depends on the TZ pin (§0)** — "tomorrow" is computed server-local;
verify no `[TZ WARNING]` in the logs. After any scheduling change, run `npm test`
and `npx tsx scripts/simulate-cr07.ts --scenario=mixed` (rule counters must stay 0).

## Backups

`deploy/backup.sh` dumps Postgres **and** tarballs the uploads dir in one run
(both are needed for a consistent restore — booking rows reference on-disk
files). It writes timestamped, atomic artifacts and prunes old ones.

Enable the nightly timer:
```bash
sudo cp deploy/rent-car-backup.service.sample /etc/systemd/system/rent-car-backup.service
sudo cp deploy/rent-car-backup.timer.sample   /etc/systemd/system/rent-car-backup.timer
# set BACKUP_DIR (+ optional BACKUP_RETENTION_DAYS, default 14) in /etc/rent_car.env
# Pre-create BACKUP_DIR owned by the service user — backup.sh runs as `rentcar`
# and can't mkdir under root-owned /var/backups (its first run would abort on set -e):
sudo mkdir -p /var/backups/rent_car && sudo chown rentcar /var/backups/rent_car
sudo systemctl daemon-reload && sudo systemctl enable --now rent-car-backup.timer
sudo systemctl start rent-car-backup        # run one now, then check $BACKUP_DIR
```
Artifacts: `db-<ts>.sql.gz` + `uploads-<ts>.tar.gz` in `BACKUP_DIR`
(default `/var/backups/rent_car`). **Copy them off the box** (rsync/object
storage) — a backup on the same disk doesn't survive a disk loss.

Restore (into an empty DB + the uploads parent):
```bash
# psql is libpq, which rejects Prisma's ?schema= parameter — strip it.
gunzip -c db-<ts>.sql.gz | psql "${DATABASE_URL%%\?*}"
tar -xzf uploads-<ts>.tar.gz -C "$(dirname "$UPLOADS_DIR")"
```

## Simulation / debug tools

`/admin/simulate` (the what-if placement sandbox) is a debugging tool, **hidden
in production** — the nav tab and the page 404 unless `ENABLE_SIMULATION=true`.
It's on by default in dev. The `scripts/simulate-cr07.ts` scenario runner is a
repo dev script (never deployed) and always available for debugging.

## Checklist before go-live
- [ ] `TZ=Asia/Bangkok` in the unit **and** `timedatectl` on the host (timers use the host zone).
- [ ] Service reaches "ready" — a wrong TZ aborts the boot with `[TZ FATAL]`.
- [ ] Seeded temporary password captured from the seed output, and rotated on every account (admin, requester, kiosk, drivers).
- [ ] `RESEND_API_KEY` set — without it password-reset links go to the journal, not to the user.
- [ ] `AUTH_SECRET` is a real random value; `NEXTAUTH_URL`/`APP_URL` = the real HTTPS host.
- [ ] `UPLOADS_DIR` on a persistent, backed-up path.
- [ ] HTTPS via nginx; `client_max_body_size 12m`.
- [ ] App bound to loopback (`-H 127.0.0.1` in the systemd unit) — port 3000 NOT reachable off-box.
- [ ] If Postgres in Docker: real `POSTGRES_PASSWORD` set (matches `DATABASE_URL`), port bound to `127.0.0.1`.
- [ ] `npm ci` succeeds (it is the first command a clean box runs).
- [ ] `npm run build` clean; migrations applied; seed run once.
- [ ] A restore has actually been rehearsed once, into a scratch database.
- [ ] Backups: `rent-car-backup.timer` enabled + artifacts copied OFF the box (see Backups).
- [ ] `ENABLE_DEV_AUTH` NOT set in prod (dev sign-in stays off — it's gated on NODE_ENV).

# Deployment — nginx + Linux server (self-hosted)

Target: a single Linux box running the Next.js app (Node) behind nginx, with
Postgres alongside. Uploads live on local disk (fine on one persistent host).

## 0. The one thing that WILL break scheduling if you skip it

**Set `TZ=Asia/Bangkok` in the app's process environment.** `runBatchAction`
(จัดรอบ) and `lib/booking/trip-legs.ts` compute day boundaries and no-wait leg
splits in *server-local* time. A default-UTC host assigns bookings to the wrong
day and splits legs at the wrong hour. The systemd unit below sets it; on boot
the app logs a loud `[TZ WARNING]` (from `instrumentation.ts`) if it's wrong —
check `journalctl -u rent-car` after starting.

## 1. Prerequisites
- Node 20 (pin 20.x), npm.
- PostgreSQL 16 (native package or Docker; the repo ships `docker-compose.yml`
  for a container if you prefer).
- nginx.
- A Linux user to own the app (e.g. `rentcar`).

## 2. Get the code + build
```bash
sudo mkdir -p /opt/rent_car && sudo chown rentcar:rentcar /opt/rent_car
sudo -u rentcar git clone <repo> /opt/rent_car
cd /opt/rent_car
sudo -u rentcar npm ci
```

## 3. Environment file
Create `/etc/rent_car.env` (root-owned, `chmod 600`, readable by the service
user). Minimum:
```
DATABASE_URL=postgresql://rentcar:<pw>@127.0.0.1:5432/rent_car?schema=public
AUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=https://booking.example.ac.th
APP_URL=https://booking.example.ac.th
UPLOADS_DIR=/var/lib/rent_car/uploads
```
Optional (features stay dormant without them):
```
GOOGLE_MAPS_API_KEY=...            # enables the "Estimate distance" button
ADOBE_SIGN_CLIENT_ID=...           # enables Adobe Sign (see docs/adobe-sign-setup.md)
ADOBE_SIGN_CLIENT_SECRET=...
ADOBE_SIGN_REFRESH_TOKEN=...
ADOBE_SIGN_SHARD=...
FACULTY_ORIGIN=คณะแพทยศาสตร์ จุฬาลงกรณ์มหาวิทยาลัย   # Maps distance origin override
```
Create the uploads dir: `sudo mkdir -p /var/lib/rent_car/uploads && sudo chown rentcar /var/lib/rent_car/uploads`.
It holds signatures, generated/signed PDFs, and attachments — **back it up**;
it is not in the database.

## 4. Database
```bash
# first deploy: migrate + seed the fleet/roster
cd /opt/rent_car
sudo -u rentcar --preserve-env=DATABASE_URL npx prisma migrate deploy
sudo -u rentcar --preserve-env=DATABASE_URL npx prisma db seed   # first time only
```
`npm run build` also runs `prisma migrate deploy`, so subsequent deploys apply
new migrations automatically. **Never** run `migrate reset` / `db push
--force-reset` on prod.

## 5. Build + run
```bash
cd /opt/rent_car
sudo -u rentcar --preserve-env TZ=Asia/Bangkok npm run build   # migrate deploy + next build
```
Install the service (`deploy/rent-car.service.sample` → `/etc/systemd/system/rent-car.service`):
```bash
sudo cp deploy/rent-car.service.sample /etc/systemd/system/rent-car.service
# edit User / WorkingDirectory if not rentcar:/opt/rent_car
sudo systemctl daemon-reload
sudo systemctl enable --now rent-car
journalctl -u rent-car -f      # confirm ready + NO [TZ WARNING]
```

## 6. nginx
`deploy/nginx.conf.sample` → `/etc/nginx/sites-available/rent_car`. Edit
`server_name` + TLS cert paths (use certbot/Let's Encrypt). Key detail:
`client_max_body_size 12m` so file uploads (10 MB cap in-app) aren't 413'd by
nginx first.
```bash
sudo ln -s /etc/nginx/sites-available/rent_car /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 7. Upgrades (each deploy)
```bash
cd /opt/rent_car
sudo -u rentcar git pull
sudo -u rentcar npm ci
sudo -u rentcar --preserve-env TZ=Asia/Bangkok npm run build   # applies new migrations
sudo systemctl restart rent-car
```
Restart is required after any migration — the running process caches the Prisma
client, so new columns 500 until restart.

## จัดรอบ (round-scheduling) in production — kept MANUAL

The daily batch is run by an admin, not a cron. Daily SOP:
1. Admin opens **/admin/batch**, picks the day, clicks **Run** — assigns
   OT/WERN/NORMAL rounds. TJW is assigned by request order separately.
2. Re-running the same day is safe (idempotent — it only touches APPROVED,
   still-unassigned bookings).
3. Because the batch is day-boundary sensitive, **the TZ pin in §0 is what makes
   it correct** — verify no `[TZ WARNING]` in the logs before going live.
4. Verify after any scheduling change:
   `npm test` and `npx tsx scripts/simulate-cr07.ts --scenario=mixed` (rule
   counters must stay 0).

If you later want it automated, a systemd timer hitting a secret-protected
"run batch" route is the path — not built now (kept manual by decision).

## Checklist before go-live
- [ ] `TZ=Asia/Bangkok` set; no `[TZ WARNING]` in `journalctl -u rent-car`.
- [ ] `AUTH_SECRET` is a real random value; `NEXTAUTH_URL`/`APP_URL` = the real HTTPS host.
- [ ] `UPLOADS_DIR` on a persistent, backed-up path.
- [ ] HTTPS via nginx; `client_max_body_size 12m`.
- [ ] `npm run build` clean; migrations applied; seed run once.
- [ ] Postgres backups scheduled (`pg_dump`) + uploads dir backed up.
- [ ] `ENABLE_DEV_AUTH` NOT set in prod (dev sign-in stays off — it's gated on NODE_ENV).

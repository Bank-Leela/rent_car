# Dev setup on a new machine

This bundle contains the one thing that is **not** on GitHub: your `.env`
(secrets + config). Everything else comes from the repo.

> ⚠️ `.env` holds secrets (DB password, auth secret, API keys). Keep this zip
> private — transfer it over AirDrop / USB / an encrypted channel, never email
> or cloud-sync it, and delete it after. Never commit `.env` (it's gitignored).

## Steps

1. **Install prerequisites**
   - **Node 20** (the repo pins Node 20; `nvm install 20` or install directly).
   - **npm** (not pnpm — see the repo's toolchain notes).
   - **Docker** (Docker Desktop on Windows/Mac, or `docker`+Colima on Mac) — for Postgres.

2. **Clone the repo**
   ```bash
   git clone https://github.com/Bank-Leela/rent_car.git
   cd rent_car
   ```

3. **Drop in the secrets** — copy the `.env` from this bundle into the repo root
   (same folder as `package.json`).
   Confirm `DATABASE_URL` matches the Docker Postgres below — it should be:
   `postgresql://postgres:postgres@localhost:5432/rent_car`

4. **Install dependencies**
   ```bash
   npm install
   ```

5. **Start Postgres** (uses the repo's `docker-compose.yml`)
   ```bash
   docker compose up -d
   ```
   (Mac + Colima instead of Docker Desktop: `brew install colima docker && colima start`, then the same `docker compose up -d`.)

6. **Create schema + seed data**
   ```bash
   npx prisma migrate deploy
   npx prisma db seed
   ```
   This applies all migrations (incl. the `btree_gist` no-double-book constraint —
   works on `postgres:16-alpine`) and seeds the fleet (6 drivers / 6 cars).

7. **Run the app**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 . Dev login has role "preview-as" buttons.

## Notes
- `uploads/` (signatures / booking PDFs / attachments) is local disk and is **not**
  in this bundle — a fresh dev DB has no uploads yet, so you don't need them.
- `.claude/settings.local.json` is per-machine (permissions) and is intentionally
  excluded — don't copy it across machines.
- Back to a native Postgres instead of Docker: point `DATABASE_URL` at it and skip
  step 5.

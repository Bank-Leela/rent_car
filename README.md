# ระบบจองรถ — Faculty Vehicle Booking

Booking and dispatch for the faculty's vehicle pool: staff request a car, the
office approves it, and the scheduler assigns a driver and vehicle by a fairness
rotation. The interface is **Thai only**.

**This is the only setup document.** If you are getting this running for the
first time, read it top to bottom and ignore every other file — several older
notes in this repo contradict each other and some of their instructions no
longer work.

Two paths. Do **A** first, even if your goal is B.

| | |
|---|---|
| **[Part A](#part-a--run-it-on-your-own-computer)** | Run it on your own computer to see it working. ~20 minutes. |
| **[Part B](#part-b--put-it-on-the-faculty-server)** | Install it on the faculty server for real use. Assumes A worked. |

---

## Three things that will otherwise cost you an afternoon

**1. There is no `.env` file in a fresh copy, and two settings are mandatory.**
`DATABASE_URL` and `AUTH_SECRET`. Copy `.env.example` to `.env` and fill them in.

**2. A missing `AUTH_SECRET` looks exactly like a wrong password.** The login
page says *"อีเมล/ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"* — wrong username or password
— even when the password is perfectly correct. If you cannot log in with a
password you are certain of, check `AUTH_SECRET` before you touch anything else.

**3. The seed prints a password once and never again.** `npx prisma db seed` is
not optional and it is not demo data: it is the only way any account comes to
exist. It prints a temporary password at the end of its output. **Copy it before
you close the terminal.** There is no way to recover it afterwards, and
re-running the seed does not reset it for most accounts — see
[If you lose the password](#if-you-lose-the-password).

---

# Part A — run it on your own computer

## A1. Install the tools

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | **20.11 – 20.x** | Not 21 or newer. `nvm install 20`, or download Node 20 from nodejs.org. |
| **npm** | comes with Node | This project uses npm, **not pnpm**. |
| **git** | any | |
| **Docker Desktop** *or* **PostgreSQL 16** | | Pick one in A3. Docker is easier. |

Check Node:

```bash
node --version     # must start with v20.
```

## A2. Get the code

```bash
cd ~
git clone https://github.com/Bank-Leela/rent_car.git
cd ~/rent_car
```

**Every command from here on runs inside `~/rent_car`** — the folder that
contains `package.json`.

## A3. Start the database — choose one

**Option 1 — Docker (recommended).**

```bash
cd ~/rent_car
docker compose up -d
```

That starts PostgreSQL 16 on `127.0.0.1:5432` with database `rent_car`, user
`postgres`, password `postgres`, reachable only from your own machine.

**Option 2 — PostgreSQL installed directly (macOS).**

```bash
brew install postgresql@16
brew services start postgresql@16
createuser -s postgres      # skip if it already exists
createdb rent_car
```

> If a connection string with a password fails on this path, drop the password:
> `postgresql://postgres@127.0.0.1:5432/rent_car?schema=public`. A default
> Homebrew install trusts local connections and ignores it.

## A4. Create your `.env`

```bash
cd ~/rent_car
cp .env.example .env
openssl rand -base64 32          # copy this output
```

Open `.env` in a text editor and paste that random string after `AUTH_SECRET=`.
The file should now read:

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/rent_car?schema=public
AUTH_SECRET=<the random string you just generated>
TZ=Asia/Bangkok
```

Everything else in the file is optional and can stay commented out.

**Never commit, email, or paste this file anywhere.** Git already ignores it.

## A5. Install the dependencies

```bash
cd ~/rent_car
npm ci
```

> Do **not** add `--omit=dev` or `--production`. The seed and the build both run
> through tools listed as development dependencies and will fail without them.

## A6. Create the database tables

```bash
cd ~/rent_car
npx prisma migrate deploy
```

> ⚠️ **Use exactly this command.** Do not use `npm run db:migrate` — that is a
> developer command which is interactive, needs a second scratch database, and
> will offer to **delete your database** if it sees anything unexpected. Do not
> use `npm run db:push` either: it creates the tables but skips the safety rules
> that stop one car being booked twice.

This also installs a PostgreSQL extension called `btree_gist`, which enforces the
no-double-booking rule. It works automatically as long as your database user owns
the database — both options in A3 satisfy that. (On the faculty server, see
[B3](#b3-service-user-and-database).)

## A7. Load the starting data — **and copy the password**

```bash
cd ~/rent_car
npx prisma db seed
```

This creates 35 departments, 6 vehicles, 6 drivers, and **9 login accounts**. At
the end it prints a box like this:

```
  TEMPORARY PASSWORD for every seeded account
  ...
  Shown once, here only — it is not stored and cannot be recovered.
```

**Copy that password into a password manager now.**

To choose the password yourself instead:

```bash
SEED_PASSWORD='your-own-password' npx prisma db seed    # at least 8 characters
```

### The accounts it creates

| Role | Username | Email |
|---|---|---|
| Admin (the office) | `admin` | admin@chula.ac.th |
| Requester (staff) | `requester` | requester@chula.ac.th |
| Driver kiosk (shared screen) | `driverstation` | driverstation@chula.ac.th |
| Drivers ×6 | `driver2` … `driver7` | driver2@ … driver7@chula.ac.th |

You will use **`admin`**. Drivers do not manage their own work in this system —
the office assigns everything, and the drivers share one screen
(`driverstation`).

> ⚠️ **Run the seed once.** Running it again on a system already in use unpairs
> every vehicle from its driver, re-pairs them to the defaults, and deactivates
> any vehicle you have added since. It is safe only on an empty database.

## A8. Start it

```bash
cd ~/rent_car
npm run dev
```

A healthy start looks like this:

```
   ▲ Next.js 16.2.5
   - Local:        http://localhost:3000
   - Environments: .env
 ✓ Ready in 2.1s
```

The line that means it worked is **`✓ Ready`**. `- Environments: .env` confirms
your settings file was found. If your computer's clock is not on Bangkok time you
will also see a long `[TZ WARNING]` block — on your own machine that is a
warning, not a failure.

Now open **<http://localhost:3000/login>**.

## A9. Your first login

1. Sign in as **`admin`** with the password the seed printed. The single box
   accepts either the username or the email address.
2. You are immediately sent to a **change-password page** and the menu is locked
   until you finish. This is intended.
3. The new password must be **at least 8 characters** and **different from the
   temporary one**.
4. This happens for **every** account the first time, so expect to do it again
   for `requester` and `driverstation` during the test below.

> ⚠️ **Eight wrong attempts locks that username for 15 minutes**, and the screen
> shows the same "wrong password" message. If you get stuck, wait 15 minutes
> rather than trying harder.

## A10. Prove it works

Follow these in order. This exercises the whole chain: request → approve →
paperwork → assign a car.

1. **Open `/admin`.** Expect it to be **almost empty**. That is correct — the
   seed creates no bookings. An empty queue is a working install.
2. **Open `/admin/fleet` and `/admin/drivers`.** You should see 6 vehicles and 6
   drivers, paired one to one.
3. **Open a second browser** (or a private window) and sign in as `requester`.
   Change its password when asked.
4. Go to **`/requester/new`** and fill in a booking.
   - Choose a trip area — *"เดินทางในจุฬาฯ"* or *"เดินทางในกรุงเทพและปริมณฑล"*.
     There is no province box; it is filled in for you.
   - **Pick a date at least 3 working days ahead.** Earlier dates are greyed out
     and simply will not select — that is the advance-notice rule, not a bug.
     (3 working days locally, 7 upcountry, 30 days for a student-course charter.)
   - Submit with **"ส่งการจอง"**.
5. **Back on `/admin`**, approve it with **"อนุมัติ"**. It is not ready to
   dispatch yet — it moves to *"รอเอกสารอนุมัติ"* (waiting for paperwork).
6. On that same card press **"เอกสารเรียบร้อย"**. The scheduler now runs
   automatically for that day.
7. **Type `/admin/batch` into the address bar.** ⚠️ **There is no menu link to
   this page** — the URL is the only way in. Pick the booking's date and press
   **"เริ่มจัดรอบ"**. The count should move from *"รอจัด"* to
   *"จัดเรียบร้อยแล้ว"*.
8. **Sign in as `driverstation`** in a third window. You land on the driver board
   at `/driver/schedule`, which is the screen drivers read each morning. It
   refreshes itself every minute.

If all eight steps work, the installation is sound.

---

# Part B — put it on the faculty server

Target: **self-hosted nginx + systemd + PostgreSQL on Linux.** Everything needed
is in [`docs/deployment.md`](docs/deployment.md), which has the full commands,
the systemd unit files, backups and TLS.

> **Ignore any mention of Vercel or Neon in older notes.** That is not the
> deployment target and it cannot work — the application deliberately refuses to
> start on a server that is not on Bangkok time.

The points below are the ones people get wrong. Read them alongside
`docs/deployment.md`.

## B1. Timezone first

Scheduling is timezone-critical, so in production the app **refuses to start** on
the wrong zone.

```bash
sudo timedatectl set-timezone Asia/Bangkok
```

and keep `Environment=TZ=Asia/Bangkok` in the service file (already in the
sample).

⚠️ **A timezone failure does not look like a failure.** `systemctl enable --now`
reports success and the service sits restarting forever. The only place you can
see it is:

```bash
journalctl -u rent-car -f      # look for [TZ FATAL]
```

Make this your first move whenever the site does not come up.

## B2. Install Node 20 system-wide

Install it from your distribution's Node 20 package (NodeSource on Debian /
Ubuntu), **not** with `nvm`. The service file calls npm by absolute path and does
not load a user shell, so an nvm installation will not be found.

## B3. Service user and database

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin rentcar
sudo -u postgres createuser --pwprompt rentcar
sudo -u postgres createdb --owner=rentcar rent_car
```

⚠️ **If Chula IT provides the database rather than you creating it**, the account
they give you must be able to run `CREATE EXTENSION btree_gist`. Owning the
database is enough — no superuser is needed. Ask for this explicitly. Without it
the very first `prisma migrate deploy` stops with *permission denied to create
extension "btree_gist"* and nothing else will work.

## B4. Create the uploads folder

```bash
sudo mkdir -p /var/lib/rent_car/uploads
sudo chown rentcar /var/lib/rent_car/uploads
```

⚠️ **Nothing creates this for you**, and the application cannot create it itself
because `/var/lib` belongs to root. Skip it and staff will be able to submit a
booking whose attachment silently vanishes, and the nightly backup will fail.
Only signatures and attachments live here — PDFs are generated on demand and are
never stored.

## B5. Certificates before nginx config

The supplied nginx file names certificate paths that do not exist yet, so nginx
will refuse to load it until the certificate is in place. Obtain the certificate
**first**, then enable the site:

```bash
sudo certbot certonly --standalone -d booking.example.ac.th
sudo ln -s /etc/nginx/sites-available/rent-car /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Doing it the other way round fails with *"no matching virtual host"*, because
certbot can only see sites nginx has actually loaded.

## B6. Restart after setting `CRON_SECRET`

The nightly scheduler timer authenticates with `CRON_SECRET`. A running
application cannot see a value added to its environment file after it started.

```bash
sudo systemctl restart rent-car          # <- the step people miss
sudo systemctl start rent-car-batch      # test it once by hand
journalctl -u rent-car-batch -n 20
```

Without the restart the timer fails silently every night, and the only symptom is
a failed unit nobody is watching.

## B7. Every placeholder you must edit

| File | Replace |
|---|---|
| `deploy/nginx.conf.sample` | `server_name` — **in both blocks**, and the two certificate paths |
| `deploy/rent-car.service.sample` | `User=`, `WorkingDirectory=`, `EnvironmentFile=`, and the absolute path to `npm` |
| `deploy/rent-car-batch.service.sample` | `EnvironmentFile=`, and the full URL it posts to |
| `deploy/rent-car-backup.service.sample` | `User=`, `EnvironmentFile=`, `ExecStart=` path |
| `deploy/backup.sh` | the folder and retention settings at the top |

Editing only one of the two `server_name` lines leaves a broken redirect that is
awkward to diagnose — check both.

---

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| *"อีเมล/ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"* with a password you know is right | `AUTH_SECRET` is missing or empty | Set it in `.env`, restart |
| Same message, suddenly, after several tries | 8 failures locked that username for 15 minutes | Wait 15 minutes |
| `Can't reach database server` | Database not running, or `DATABASE_URL` wrong | `docker compose up -d`, check the URL |
| `permission denied to create extension "btree_gist"` | Database account lacks rights | Use an account that owns the database |
| Server keeps restarting, `systemctl` says nothing useful | Wrong timezone | `journalctl -u rent-car -f`, look for `[TZ FATAL]` |
| `prisma migrate dev` hangs or offers to reset | Wrong command | Use `npx prisma migrate deploy` |
| Login works, but every page bounces back | Password change not finished | Complete the change-password page |
| Date you want is greyed out in the picker | Advance-notice rule (3 / 7 / 30 days) | Pick a later date, or mark the booking urgent |
| `/admin` is empty after a fresh install | Correct — the seed creates no bookings | Create one via `/requester/new` |
| Nightly scheduler unit fails | `CRON_SECRET` added after the app started | `sudo systemctl restart rent-car` |

### If you lose the password

Do **not** re-run the seed. It will not help — it does not reset the drivers'
passwords at all — and on a live system it unpairs the whole fleet. Use:

```bash
cd /opt/rent_car          # or ~/rent_car locally
npx tsx scripts/reset-password.ts
```

---

## For developers

Day-to-day commands:

```bash
make check       # typecheck + lint + tests — run this before every commit
make sim         # the seven scheduling scenarios; must exit 0
npm run dev      # development server
npm run db:studio  # browse the database
```

Developer troubleshooting, carried over from the older setup notes:

| Symptom | Fix |
|---|---|
| `P1010` / role "postgres" denied | `createuser -s postgres` |
| `prisma migrate dev` hangs | Use `npx prisma migrate deploy` — non-interactive |
| Booking tests fail with unique-constraint races | `npx vitest run --no-file-parallelism` |
| Type errors straight after a `git pull` | `npx prisma generate` |

Start here:

- [`docs/PROJECT-OVERVIEW.md`](docs/PROJECT-OVERVIEW.md) — what the system is,
  the roles, the booking lifecycle, the subsystems.
- [`docs/scheduling-algorithm.md`](docs/scheduling-algorithm.md) — the source of
  truth for every dispatch rule. Read it before changing anything under
  `lib/booking/`.
- [`docs/deployment.md`](docs/deployment.md) — the full server runbook.
- [`AGENTS.md`](AGENTS.md) — conventions, and which large files are deliberately
  left large.
- [`HANDOFF.md`](HANDOFF.md) — project context and decisions already settled.

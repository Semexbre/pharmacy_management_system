## Project Information

##Purpose: Pharmacy PMS is an offline-first desktop application that helps a pharmacy manage medicine inventory, sell with a barcode point of sale, and avoid expired or out-of-stock medicines, without needing an internet connection.

Main features:batch and expiry tracking, barcode POS with earliest-expiry-first selling and printable receipts, low-stock and near-expiry alerts, Admin/Cashier login with password reset, and local database backups.

Video presentation:

## Team Members

| Full name |                CTC ID |
SEMERE ABERA HAILEMARIAM       CTC-5267-26


# Pharmacy PMS

## Development

Use Node.js 22.12 or newer. Install dependencies with `npm install`; the install
hook downloads the Electron runtime. SQLite 13 includes prebuilt Node-API
binaries, so this setup does not force a Visual Studio native rebuild.

- `npm start`: build CSS and open the desktop application.
- `npm run dev`: open the desktop application and watch CSS changes.
- `npm run serve`: build CSS and start the browser server at http://127.0.0.1:3000.
- `npm test`: run HTTP, database, and validation regression checks in memory.
- `npm run test:desktop`: test login, POS, alerts and backup export using a hidden window and disposable database. The folder dialog is stubbed to select a temporary directory.

The desktop app stores `pharmacy.db` in Electron's per-user application data
directory. Browser development uses `data/pharmacy.db`; set `PMS_DB_PATH` to
override it. These are separate databases. Server and test commands use
Electron's Node runtime to match desktop execution.

## Layout

`src/` contains the Express app, database migrations, modules, utilities, and EJS
views. `electron/main.js` starts the desktop window. Static files live in
`electron/public/`; `app.css` is generated from `input.css` by Tailwind.

Expiry comparisons use the workstation's local calendar date. A batch is
expired after its printed date; batches expiring within 90 days are marked as
near expiry. Money is stored as integer minor units.

## Stock alerts

The dashboard and `/alerts` offer 30-, 60-, and 90-day expiry windows (default
90). Windows include today and the final day; expired batches appear separately.
Filter the alerts page by alert type, medicine name, or batch number. Summary
cards and navbar badges show overall counts for the selected window; search
narrows the lists only. Counts refresh on page navigation, including the receipt
after checkout.

Low stock counts medicines whose total stock on hand is at or below their
reorder level, including medicines with no batches and zero stock. This total
includes expired stock. Expiry alerts count only batches with positive stock.
Active and inactive medicines are included, with inactive entries labelled.
Expired stock is flagged for write-off review; the alerts feature never writes
off stock or changes inventory automatically.

All alert queries are reads and use the existing stock/expiry indexes. No
migration or new dependency is required. `npm test` seeds isolated in-memory
fixtures to check threshold/date boundaries, filters, and counts before and
after a sale; it does not insert demonstration records into your pharmacy DB.

## Local accounts

First run: sign in with username `admin` and password `admin123`. You must set
a different password before accessing the app. Passwords require at least 12
characters and at most 72 UTF-8 bytes. The Phase 5 migration also requires
existing accounts to change their passwords once, preserving their records.

Cashiers can access POS and their own receipts. Administrators can also access
inventory, alerts, user management and backups. New users and password resets
receive temporary passwords that must be changed. Resetting a password or
deactivating an account immediately invalidates its existing sessions. The
current administrator cannot deactivate their own account.

Sessions are stored locally in `sessions.db`, separate from pharmacy backups;
the signing secret lives in `session-secret`. Cookies are HttpOnly and
SameSite=Strict. Secure cookies are disabled because the application uses HTTP
on loopback only. Sessions expire after 30 minutes idle or eight hours from
login. Login is limited to 10 attempts per local address per 15 minutes, with
the limit persisted across restarts. Forms and POS checkout use session-bound
CSRF tokens, and requests from foreign origins/hostnames are rejected.

## Backups and restore

Backups use SQLite's online backup API, including committed WAL data, and are
stored in Electron's `userData/backups/`. Browser mode uses `data/backups/`
(or the configured database directory). A backup runs at startup, every six
hours while the app is running, and when an admin selects **Back up now**.
The newest 30 timestamped files are retained. Backup failures appear in the
administrator navigation and on the backups page.

Choose **Copy to folder…** in the desktop app to select a USB drive or another
folder using Electron's native dialog. Existing destination files are never
overwritten. Backups are ordinary, unencrypted SQLite databases; keep backup
media and the operating-system account private. Application login does not
encrypt the database or prevent someone with filesystem access from reading it.

To restore, sign in as an admin, choose **Review restore**, enter your current
password and type `RESTORE`. The app validates the backup, pauses requests,
creates a safety backup, checkpoints and closes the live database, replaces
it, and signs everyone out. Sign back in with credentials from the selected
backup. Interrupted file swaps are recovered before the next startup opens the
database. Restore is limited to the application's local backup list; external
copies can be copied back into that directory while the app is closed.

`npm test` checks direct cashier URL denial, forced password changes, CSRF,
session revocation, rate limits, independent SQLite backup reads, scheduled
backups, retention, confirmed restore, rollback and interrupted-restore recovery.
All security and restore tests use disposable databases, never pharmacy records.

# Pharmacy PMS

## Development

Build on Windows x64 with Node.js 22.12 or newer and npm. End users do not need
Node.js, npm, Python or Visual Studio. Build-time downloads require internet;
the installed application runs offline. Install all dependencies with
`npm install` (do not use `--omit=dev` on the build machine). The postinstall
command is `electron-builder install-app-deps`.

- `npm start`: build CSS and open the desktop application.
- `npm run dev`: open the desktop application and watch CSS changes.
- `npm run dist:dir`: build CSS and the unpacked Windows application.
- `npm run dist`: build CSS, the NSIS installer and portable executable.
- `npm test`: run HTTP, database, and validation regression checks in memory.
- `npm run test:desktop`: test login, POS, alerts and backup export using a hidden window and disposable database. The folder dialog is stubbed to select a temporary directory.

Development and installed apps now use the same per-user application data
folder, `%APPDATA%\Pharmacy PMS`. The plain server launcher has been removed.
Tests use Electron's Node runtime and disposable databases, not pharmacy data.

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
excludes expired stock. Expiry alerts count only batches with positive stock.
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

Cashiers can access POS, their own receipts, and the read-only dashboard at
`/dashboard`. The dashboard omits profit, cost, inventory value and margin for
cashiers. Administrators can also access
inventory, alerts, user management and backups. New users and password resets
receive temporary passwords that must be changed. Resetting a password or
deactivating an account immediately invalidates its existing sessions. The
current administrator cannot deactivate their own account.

Sessions are stored locally in `sessions.db`, separate from pharmacy backups;
the signing secret lives in `session-secret`. Cookies are HttpOnly and
SameSite=Lax. Secure cookies are disabled because the application uses HTTP
on loopback only. Sessions expire after 30 minutes idle or eight hours from
login. Login is limited to 10 attempts per local address per 15 minutes, with
the limit persisted across restarts. Forms and POS checkout use session-bound
CSRF tokens, and requests from foreign origins/hostnames are rejected.

## Backups and restore

Backups use SQLite's online backup API, including committed WAL data, and are
stored in Electron's `userData/backups/`. A backup runs at startup, every six
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

## Analytics dashboard

The shared sidebar and dashboard run entirely offline using local SVG charts,
system fonts and inline SVG icons. No chart dependency or vendor download is
needed. The existing static directory is `electron/public/`; include that whole
directory (including generated `css/app.css` and `js/*.js`) with `src/views/`
when packaging Electron. `electron-builder.yml` includes those paths.

Dashboard data is fetched from the authenticated
`/dashboard/api/summary?range=30&days=90` endpoint. Supported ranges are `today`,
`7`, `30` (default), and `month`; expiry tiers remain 30/60/90 (default 90).
All sales widgets exclude voided sales. Profit uses sale-item cost snapshots.
Daily grouping follows the workstation's local timezone. Money remains integer
minor units, formatted with the existing server utility.

Inventory cost and stock alerts are current snapshots, independent of the sales
range. Their historical percentage changes show a dash because there is no
stock history table. Inventory cost includes physical expired stock; stock
availability and low-stock alerts exclude expired units. Stock categories are
mutually exclusive: the low-stock KPI includes the donut's low and out-of-stock
categories. Inactive medicines remain included, matching the alerts page.

Top-seller revenue is before sale-level discounts; overall revenue is after
discounts. Recent receipts are limited to the selected range; cashiers only get
links to their own receipts. There is no sales-list page, so no unsupported
“View all transactions” link is added. Cashiers retain their POS landing page
and cannot reach inventory, full alerts, users or backups by direct URL.

See [dashboard delivery notes and manual checks](docs/dashboard.md).

## Windows release build

Packaging files added: `electron-builder.yml`, `electron/diagnostics.js`,
`scripts/run-desktop-test.js`, and `tests/packaging.test.js`. Updated:
`package.json`, `package-lock.json`, `electron/main.js`, `src/app.js`,
`src/server.js`, the cookie-clearing options in `src/modules/auth/routes.js`
and `src/modules/backups/routes.js`, `tests/security.test.js`,
`tests/desktop.js`, and this README. The existing `.gitignore` already excludes
`dist/`, `node_modules/`, generated `app.css`, and SQLite files.

From the project directory in PowerShell:

```powershell
npm install
npm run css:build
npm test
npm run test:desktop
npm run dist:dir
npm run dist
```

`dist:dir` produces `dist\win-unpacked\Pharmacy PMS.exe`. Distribute the NSIS
`dist\Pharmacy PMS-Setup-1.0.0-x64.exe` for installation, or
`dist\Pharmacy PMS-Portable-1.0.0-x64.exe` for portable use. The unpacked EXE
needs its entire `win-unpacked` folder beside it. The installer permits a custom
installation directory and creates a desktop shortcut. The portable build also
stores data under the Windows user's AppData, not next to the EXE or on its USB.

The only new direct build dependency is `electron-builder`; Electron and the
builder belong in `devDependencies`. Express, EJS, bcryptjs, express-session,
better-sqlite3 and their production dependency tree are bundled automatically.
SQLite is unpacked from ASAR so Windows can load its native binary. Source files
are restricted to `electron/**`, `src/**`, `public/**` and `package.json`;
tests, documentation, databases, sessions and logs are excluded.

No custom icon is provided. Add a Windows ICO file at `build/icon.ico` (include
a 256×256 image) and uncomment `win.icon` in `electron-builder.yml`. Until then
the build uses Electron's default icon. No image is downloaded at runtime.

These builds are unsigned. Windows SmartScreen may show “Windows protected your
PC” or “Unknown publisher”. On a machine where you trust the source of this
installer, use **More info → Run anyway** if permitted by your administrator.
Do not disable system-wide protection. A publisher signing certificate is not
included and signing/SmartScreen reputation has not been verified.

## Persistent data and legacy migration

`app.setName('Pharmacy PMS')` runs before any data path lookup. For both installed
and portable versions, `app.getPath('userData')` normally resolves to:

```text
%APPDATA%\Pharmacy PMS\
  pharmacy.db                 pharmacy records and password hashes
  pharmacy.db-wal / -shm       SQLite sidecars while running
  sessions.db                 local sessions and login limits (plus sidecars)
  session-secret              randomly generated once, reused on restart
  backups\                    timestamped SQLite backups
  logs\startup.log            latest database path and localhost port
  logs\startup-error-*.log    last 5 errors: time, stage and safe error code only
```

Electron's cache/cookie files also live in its user profile. Automatic application
writes never target the installation directory. Backup export explicitly writes
to the folder selected by the user, such as a USB drive; the application folder
is rejected as an export destination. Migrations, EJS views and static files are
read from the packaged application using `__dirname` paths.

Older versions used `%APPDATA%\pharmacy-pms`. If an old `pharmacy.db` exists and
the new location has none, the application logs a notice only. It never copies
or overwrites the old database. Starting the new app otherwise initializes a
fresh database, so an empty dashboard does not mean the old data was deleted.

To move existing data manually:

1. Close every old and new Pharmacy PMS window. Keep an independent backup.
2. Before the first new launch, create `%APPDATA%\Pharmacy PMS` and manually copy
   the old `pharmacy.db` into it. If the new app has already initialized a DB,
   first move its whole profile folder aside as a safety copy; never overwrite
   a database you have not inspected and backed up.
3. For a live database copy, close the old app cleanly first. If `pharmacy.db-wal`
   and `pharmacy.db-shm` still exist, preserve them alongside the matching DB as
   one set. Do not combine sidecars from different databases. Prefer an app-made
   WAL-safe backup file if the old app can still run.
4. Optionally copy the `backups` directory. Do not copy `sessions.db`, its sidecars,
   browser cache or `session-secret`; the new app creates fresh sessions. User
   accounts and password hashes are already inside the pharmacy database.
5. Launch the new app and sign in with the account/password from the copied DB.
   Check inventory and recent transactions before making new sales.

For another PC, make an on-demand backup, copy it to a USB drive, and close the
source app. Install on the destination PC, then place that backup as
`%APPDATA%\Pharmacy PMS\pharmacy.db` before first launch (no WAL sidecars are
needed for a completed app backup). Alternatively initialize the destination,
copy the backup into its `backups` folder while closed, then use the admin
restore flow. Restore replaces data and signs users out. Keep the source copy
until the destination is verified. Installer upgrades/reinstalls do not change
the AppData folder; the uninstaller is configured to retain it.

## Common build problems

- **Symlink / “A required privilege is not held by the client”:** enable Windows
  Developer Mode in Settings and retry. Some builder tools unpack archives with
  symbolic links. If organizational policy prevents this, ask the administrator
  to enable the required privilege or run the trusted build from an elevated
  terminal. This is a build-machine requirement, not an end-user requirement.
- **Missing Visual Studio during SQLite rebuild:** SQLite 13 ships Node-API
  prebuilds, including Windows x64. The pinned builder uses its `legacy` native
  installer with `npmArgs: [--ignore-scripts]` because npm's explicit rebuild
  still invokes node-gyp despite `gypfile:false`. These arguments apply only to
  builder's dependency setup; normal `npm install` still runs postinstall.
  The shipped binary is exercised by the Electron tests and packaged smoke check.
  The `@electron/node-gyp` override uses its published registry release instead
  of a GitHub-only dependency, avoiding an additional Git source checkout.
  Recheck this setting when changing native dependencies or architecture. If a
  new dependency needs compilation, remove `--ignore-scripts` and install Visual
  Studio C++ Build Tools and Python on the build machine. Avoid upgrading the
  builder independently without rechecking installation and the packaged module.
- **`NODE_MODULE_VERSION` mismatch / native module cannot load:** use a clean
  checkout with `npm ci`, run `npm run postinstall`, and rebuild the package.
  Do not copy `node_modules` or native binaries from another Node/Electron version
  or CPU architecture, and do not use plain `node src/server.js`. Current SQLite
  13 uses Node-API prebuilds; confirm the selected Windows binary is present under
  `resources\app.asar.unpacked\node_modules\better-sqlite3\prebuilds`.
- **Package works in development but “Cannot find module” after installation:**
  runtime imports must be in `dependencies`. Development dependencies are omitted
  from the application. Install dev dependencies on the build machine and rebuild;
  never use `--omit=dev` for packaging. Confirm the missing EJS/static/SQL file is
  in the allowed `files` paths and resolved relative to `__dirname`.
- **File in use / EPERM writing `dist`:** close the unpacked app, installed app
  or installer launched from that build before packaging again.
- **Startup fails:** check the profile's `logs` folder and available disk space/
  write permissions. Startup-error logs omit raw exception text, SQL, passwords
  and session secrets. The friendly dialog does not reset the database.

Builder configuration follows the [electron-builder v26 documentation](https://www.electron.build/v26/docs/configuration/)
and [NSIS options](https://www.electron.build/v26/docs/nsis/).

## Clean Windows PC acceptance checklist

Verified on this Windows x64 build machine: dependency installation/postinstall,
CSS, all 30 automated tests, smoke checks, hidden Electron desktop tests,
`npm run dist:dir`, and `npm run dist` passed. Both the NSIS installer and portable
EXE were produced. SHA-256 hashes are in `dist/SHA256SUMS.txt`.

The unpacked EXE was launched from a terminal with an isolated temporary
`--user-data-dir` profile, leaving real pharmacy data untouched. Its startup log
confirmed that database path. First-run login/password change, authenticated
`/health` (HTTP 200, `status: ok`), packaged pages/assets, a sale and receipt,
backup SQLite integrity, confirmed restore, and normal quit/relaunch all passed.
Stock, password and session secret persisted across restart; the HTTP server
closed and the database WAL was released on quit. Package inspection confirmed
migrations/views/static files and the unpacked Windows SQLite binary are present;
project tests/docs and database files are excluded.

A separate clean PC without Node, physical Wi-Fi-off operation, installer UI,
reinstall/uninstall persistence, portable-launch behavior, physical USB export,
printing, SmartScreen behavior and packaged DevTools keyboard checks have not
been verified. Complete the following acceptance checklist before deployment.

- [ ] On a clean Windows x64 PC without Node/npm, install using the NSIS EXE;
      choose a directory and verify the desktop shortcut.
- [ ] Turn Wi-Fi off, launch, log in, and complete first-run password change.
- [ ] Add a test medicine and batch, make a sale, and open/print its receipt.
- [ ] Close normally, reopen, and verify stock, sale history and password persist.
- [ ] Check `logs\startup.log`: DB is under `%APPDATA%\Pharmacy PMS`, outside the
      install directory. Using its local port, `/health` redirects anonymous
      requests to login and returns `{ "status": "ok", ... }` after authentication
      and any mandatory password change.
- [ ] Confirm no menu or DevTools opens via F12 or Ctrl+Shift+I/J/C. Verify no
      internet is needed by styles, icons, charts, POS, login or backup.
- [ ] Reinstall/upgrade to the same or a different installation directory, then
      reopen and verify all existing data and accounts survive.
- [ ] Create a backup, copy it to USB, make another test sale, and restore the
      earlier backup with admin confirmation. Sign in again and verify earlier
      stock and history return.
- [ ] Test the portable EXE on a clean PC too; confirm it uses that Windows
      user's AppData and does not create a DB beside the portable file.
- [ ] Verify legacy migration and transfer to another PC with disposable data
      before moving the real pharmacy database.

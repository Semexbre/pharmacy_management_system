# Dashboard delivery

## Files

Created:

- `src/modules/dashboard/service.js`: local date ranges, integer monetary aggregates, shared alert queries, and role-filtered plain objects.
- `src/modules/dashboard/routes.js`: page and authenticated JSON endpoint.
- `src/views/partials/icon.ejs`: local SVG icons.
- `electron/public/js/dashboard.js`: safe DOM rendering, accessible SVG charts, retry and empty states.
- `electron/public/js/shell.js`: keyboard-accessible collapsible navigation.
- `tests/dashboard.test.js`: in-memory calculations and HTTP permission tests.
- `docs/dashboard.md`: delivery and verification notes.

Changed:

- `src/app.js`: dashboard mounting and shared range/badge locals.
- `src/modules/alerts/service.js`: shared stock categories; expired units excluded from low-stock calculations.
- `src/views/layouts/main.ejs`: sidebar, top bar, role-aware links, search and range controls, print layout.
- `src/views/dashboard/index.ejs`: dashboard panels and loading states.
- `src/views/alerts/index.ejs`: clarify non-expired stock counts.
- `electron/public/css/input.css`: card styling and visible keyboard focus.
- `electron/public/css/app.css`: regenerated local Tailwind output (gitignored).
- `tests/alerts.test.js`: expired-stock regression expectations.
- `tests/desktop.js`: native dashboard rendering, responsive navigation, two-batch sale, external-network blocking, and receipt PDF generation.
- `package.json`: include dashboard tests in the standard suite.
- `README.md`: dashboard behavior, role rules, and packaging notes.

No migration, framework, bundler, CDN asset, chart package or production fixture was added. Charts use hand-written SVG, as permitted by the request. The pasted request referred to a mockup image but did not include one; the design follows its written visual requirements.

## Calculation decisions

- Sales dates use local midnight converted to UTC ISO boundaries, with an exclusive upper bound. Daily buckets use SQLite `date(created_at, 'localtime')`. Calendar-day arithmetic handles varying month lengths and daylight-saving boundaries.
- Sale revenue is aggregated before joining item rows, preventing multi-batch duplication. Cost uses each sold item's `unit_cost`, including sale discounts in gross profit through `sales.total`.
- Previous periods contain the same number of calendar days. Zero baselines show a dash, including zero-to-zero changes. The stock KPIs also show a dash: the schema cannot provide trustworthy historical inventory snapshots.
- Inventory value includes physical stock at cost, including expired stock. Sellable-stock categories exclude expired batches. Low-stock alert counts include zero-stock medicines; the donut splits these into separate categories.
- All administrative costs and profit fields are omitted from cashier JSON, not just hidden in the view. The cashier's existing POS redirect and access restrictions remain unchanged. The additional `/dashboard` route provides read-only sales and alerts.

## Automated verification

Run `npm test` for the full database, route, security and smoke suite; it rebuilds CSS first. Run `npm run test:desktop` for a hidden Electron window with disposable data. Desktop tests exercise the real login/password forms, dashboard empty state, 1024px navigation, a two-batch checkout, offline asset behavior, and receipt PDF generation. The test does not switch off the computer's Wi-Fi: it rejects non-local network requests.

## Manual checklist

Use a disposable test database, especially for voided-sale fixtures. Do not edit live pharmacy records for testing.

- [ ] Fresh database: finish initial password change; dashboard shows zero sales, 30 daily points, empty lists, empty donut rings, and dashes without NaN/Infinity.
- [ ] Two-batch sale: receive two batches with different costs and prices; sell enough to span both. Revenue equals the receipt once, cost equals both snapshot costs, profit equals revenue minus cost. Change a remaining batch's cost and confirm past profit stays unchanged.
- [ ] Voided sale: mark a fixture sale as voided in the disposable database. Confirm it disappears from revenue, cost, profit, daily buckets, top sellers, payments and recent transactions. This upgrade does not introduce a void-sale workflow.
- [ ] Expired batch: add positive stock with yesterday's expiry date. Confirm expired count and write-off flag, exclusion from sellable stock, and agreement between dashboard, sidebar and alerts. A medicine with only expired units is out of stock. Compare 30/60/90 windows.
- [ ] Cashier login: landing page remains POS; open Dashboard from navigation. Sales/transactions/top sellers/alerts display, while profit/cost/margin/inventory value are absent from HTML and API JSON. Admin URLs still return 403; only own receipts have links.
- [ ] Range controls: test Today, 7 days, 30 days and This month; verify zero days, previous-period percentages and near-expiry tier preservation. Search from the admin top bar opens filtered inventory.
- [ ] Accessibility and resizing: at 1024px open navigation with the hamburger, tab through it, and close with Escape. Check focus rings, chart points/tooltips, narrow tables and no page-level horizontal scroll. At wider sizes verify the permanent sidebar.
- [ ] Receipt printing: open a receipt and print preview; sidebar, top bar and navigation buttons are hidden, and receipt content uses the page width.
- [ ] Wi-Fi off: restart with Wi-Fi disabled; sign in, change ranges, make a test sale and revisit Dashboard. Confirm charts, icons, CSS and totals load without internet.
- [ ] Session expiry: after a session expires, dashboard shows a useful error/reload message rather than stale claims of success; login restores access.

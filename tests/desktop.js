// Exercise the real Electron entry point with a hidden window and disposable DB.
const assert = require('node:assert/strict');
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dataDir = process.env.PMS_DESKTOP_TEST_DIR;
assert.ok(dataDir, 'Run this test with npm run test:desktop');
app.setPath('userData', dataDir);
app.setPath('sessionData', dataDir);
const exportDir = path.join(dataDir, 'usb');
fs.mkdirSync(exportDir);
let folderDialogCalls = 0;
dialog.showOpenDialog = async (_parent, options) => {
  assert.ok(options.properties.includes('openDirectory'));
  folderDialogCalls++;
  return { canceled: false, filePaths: [exportDir] };
};
const serverModule = require('../src/server');
const startServer = serverModule.startServer;
let testServer;
serverModule.startServer = async (options) => {
  testServer = await startServer({ ...options, dbPath: path.join(dataDir, 'pharmacy.db'), dataDir });
  return testServer;
};
BrowserWindow.prototype.show = function () {};
dialog.showErrorBox = (title, message) => console.error(title, message);
const timeout = setTimeout(() => { console.error('Desktop startup timed out'); app.exit(1); }, 45000);
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('did-fail-load', (_event, code, message) => {
    console.error(code, message);
    app.exit(1);
  });
  window.webContents.once('did-finish-load', async () => {
    try {
      const origin = new URL(window.webContents.getURL()).origin;
      const loginHeading = await window.webContents.executeJavaScript("document.querySelector('h1').textContent");
      assert.equal(loginHeading, 'Sign in');
      // Real form navigation is different from fetch: exercise the same submission
      // path used by a person pressing Sign in or Change password.
      async function submitForm(code) {
        const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
        await window.webContents.executeJavaScript(code);
        await loaded;
      }
      await submitForm(`
        document.getElementById('username').value = 'admin';
        document.getElementById('password').value = 'admin123';
        document.querySelector('form[action="/login"]').requestSubmit();
      `);
      assert.equal(new URL(window.webContents.getURL()).pathname, '/change-password', 'Native login form must reach password change');
      await submitForm(`
        document.getElementById('current_password').value = 'admin123';
        document.getElementById('password').value = 'Desktop-Secure-Test!';
        document.getElementById('confirm').value = 'Desktop-Secure-Test!';
        document.querySelector('form[action="/change-password"]').requestSubmit();
      `);
      assert.equal(new URL(window.webContents.getURL()).pathname, '/', 'Native password form must reach dashboard');
      const result = await window.webContents.executeJavaScript(`({
        title: document.title,
        heading: document.querySelector('h1')?.textContent,
        styles: document.styleSheets.length,
        script: Boolean(document.querySelector('script[src="/js/app.js"]'))
      })`);
      assert.equal(result.title, 'Dashboard · Pharmacy PMS');
      assert.equal(result.heading, 'Dashboard');
      assert.ok(result.styles > 0);
      assert.equal(result.script, true);
      async function dashboardReady() {
        await window.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 200; i++) {
            if (document.getElementById('dashboard')?.dataset.loaded === 'true') return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error(document.getElementById('dashboard-status')?.textContent || 'Dashboard did not load');
        })()`);
      }
      await dashboardReady();
      assert.equal(await window.webContents.executeJavaScript("document.querySelector('[data-kpi=revenue]').textContent"), '0.00');
      assert.equal(await window.webContents.executeJavaScript("document.querySelectorAll('#sales-chart circle').length"), 30);
      window.setSize(1024, 800);
      await window.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      assert.equal(await window.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth'), true, 'No horizontal scrolling at minimum width');
      await window.webContents.executeJavaScript("document.getElementById('sidebar-toggle').click()");
      assert.equal(await window.webContents.executeJavaScript("document.getElementById('sidebar-toggle').getAttribute('aria-expanded')"), 'true');
      await window.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
      assert.equal(await window.webContents.executeJavaScript("document.getElementById('sidebar-toggle').getAttribute('aria-expanded')"), 'false');
      window.setSize(1440, 1000);
      const db = require('../src/db/connection').getDb();
      db.exec(`INSERT INTO medicines (name, barcode) VALUES ('Desktop test', 'DESKTOP');
        INSERT INTO inventory_batches (medicine_id, batch_number, expiry_date, purchase_cost, selling_price, quantity_received, quantity_on_hand)
        VALUES (1, 'EARLY', '2098-01-01', 500, 1000, 1, 1), (1, 'LATE', '2099-01-01', 500, 1200, 5, 5);`);
      await window.loadURL(origin + '/alerts?type=low&days=30');
      const alertPage = await window.webContents.executeJavaScript(`({
        heading: document.querySelector('h1').textContent,
        low: document.querySelector('[data-alert-count="low"]').textContent,
        days: document.getElementById('days').value,
        type: document.getElementById('type').value,
        hasMedicine: document.getElementById('low-heading').parentElement.textContent.includes('Desktop test'),
        hasNearList: Boolean(document.getElementById('near-heading'))
      })`);
      assert.deepEqual(alertPage, { heading: 'Stock alerts', low: '1', days: '30', type: 'low', hasMedicine: true, hasNearList: false });
      await window.loadURL(origin + '/pos');
      const cartResult = await window.webContents.executeJavaScript(`(async () => {
        const scan = document.getElementById('scan');
        scan.value = 'DESKTOP';
        scan.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        for (let i = 0; i < 100 && !document.querySelector('#cart-body input'); i++) await new Promise(r => setTimeout(r, 20));
        const quantity = document.querySelector('#cart-body input');
        quantity.value = '2';
        quantity.dispatchEvent(new Event('change', { bubbles: true }));
        const tendered = document.getElementById('tendered');
        tendered.value = '22';
        tendered.dispatchEvent(new Event('input', { bubbles: true }));
        const total = document.getElementById('total').textContent;
        let requests = 0, finish;
        window.fetch = () => { requests++; return new Promise(resolve => { finish = resolve; }); };
        const checkout = document.getElementById('checkout');
        checkout.click();
        tendered.dispatchEvent(new Event('input', { bubbles: true }));
        checkout.click();
        const pendingDisabled = checkout.disabled;
        finish({ ok: false, json: async () => ({ error: 'Test rejection' }) });
        await new Promise(r => setTimeout(r, 0));
        return { total, requests, pendingDisabled, retryEnabled: !checkout.disabled };
      })()`);
      assert.equal(cartResult.total, '22.00');
      assert.equal(cartResult.requests, 1);
      assert.equal(cartResult.pendingDisabled, true);
      assert.equal(cartResult.retryEnabled, true);
      await window.loadURL(origin + '/backups');
      const copied = await window.webContents.executeJavaScript(`(async () => {
        const token = document.querySelector('meta[name="csrf-token"]').content;
        const response = await fetch('/backups', { method: 'POST', headers: { 'X-CSRF-Token': token } });
        if (!response.ok) throw new Error('Backup failed');
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        const action = doc.querySelector('form[action$="/export"]').getAttribute('action');
        const result = await fetch(action, { method: 'POST', headers: { 'X-CSRF-Token': token } });
        return result.ok;
      })()`);
      assert.equal(copied, true);
      assert.equal(folderDialogCalls, 1);
      assert.equal(fs.readdirSync(exportDir).filter(name => name.endsWith('.db')).length, 1);
      // Exercise analytics after a real checkout spanning two cost/price batches.
      require('../src/modules/pos/service').checkout({ items: [{ medicine_id: 1, quantity: 2 }], payment_method: 'card' }, 1);
      // Deny non-local requests to verify the dashboard needs no internet assets.
      const externalRequests = [];
      window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        const external = /^https?:/.test(details.url) && new URL(details.url).origin !== origin;
        if (external) externalRequests.push(details.url);
        callback({ cancel: external });
      });
      await window.loadURL(origin + '/?range=7&days=30');
      await dashboardReady();
      assert.equal(await window.webContents.executeJavaScript("document.querySelector('[data-kpi=revenue]').textContent"), '22.00');
      assert.equal(await window.webContents.executeJavaScript("document.querySelector('[data-kpi=profit]').textContent"), '12.00');
      assert.equal(await window.webContents.executeJavaScript("document.querySelectorAll('#sales-chart circle').length"), 7);
      assert.equal(await window.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth'), true);
      assert.equal(await window.webContents.executeJavaScript("getComputedStyle(document.getElementById('sidebar')).display"), 'flex', 'Sidebar stays visible on wide windows');
      assert.deepEqual(externalRequests, []);
      if (process.env.PMS_DASHBOARD_SCREENSHOT) {
        fs.writeFileSync(process.env.PMS_DASHBOARD_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
        await window.webContents.executeJavaScript('scrollTo(0, document.body.scrollHeight); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        fs.writeFileSync(process.env.PMS_DASHBOARD_SCREENSHOT.replace(/\.png$/, '-bottom.png'), (await window.webContents.capturePage()).toPNG());
      }
      const saleId = db.prepare('SELECT id FROM sales ORDER BY id DESC LIMIT 1').pluck().get();
      await window.loadURL(origin + '/pos/receipt/' + saleId);
      const pdf = await window.webContents.printToPDF({ printBackground: true });
      assert.ok(pdf.length > 1000, 'Receipt still prints with the shared shell');
      console.log('PASS: Electron login/password change, alerts, POS, backup and native folder-picker integration');
      clearTimeout(timeout);
      window.close();
    } catch (err) {
      console.error(err);
      if (testServer) await testServer.close();
      app.exit(1);
    }
  });
});
require('../electron/main');

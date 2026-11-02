const assert = require('node:assert/strict');
const ADMIN_PASSWORD = 'Phase5-Test-Admin!';
function client(origin, initialCookie = '') {
  let cookie = initialCookie, token = '';
  return {
    get cookie() { return cookie; },
    get token() { return token; },
    async fetch(url, init = {}) {
      const headers = new Headers(init.headers || {});
      if (cookie) headers.set('Cookie', cookie);
      if (token && !['GET', 'HEAD'].includes((init.method || 'GET').toUpperCase()) && !headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', token);
      const res = await fetch(url.startsWith('http') ? url : origin + url, { redirect: 'manual', ...init, headers });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      if ((res.headers.get('content-type') || '').includes('text/html')) {
        const body = await res.clone().text();
        const match = body.match(/name="csrf-token" content="([^"]*)"/);
        if (match) token = match[1];
      }
      return res;
    },
    async form(url, data) {
      return this.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data) });
    },
    async login(username = 'admin', password = 'admin123', newPassword = ADMIN_PASSWORD) {
      await this.fetch('/login');
      const response = await this.form('/login', { username, password });
      assert.equal(response.status, 302, await response.clone().text());
      if (response.headers.get('location') === '/change-password' && newPassword) {
        await this.fetch('/change-password');
        const changed = await this.form('/change-password', { current_password: password, password: newPassword, confirm: newPassword });
        assert.equal(changed.status, 302, await changed.clone().text());
      }
      await this.fetch('/change-password'); // obtain the regenerated session's CSRF token
      return response;
    },
  };
}
module.exports = { client, ADMIN_PASSWORD };

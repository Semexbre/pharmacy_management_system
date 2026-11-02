function redirectWithFlash(res, url, text, type = 'success') {
  const qs = new URLSearchParams({ msg: text, type }).toString();
  res.redirect(`${url}${url.includes('?') ? '&' : '?'}${qs}`);
}

module.exports = { redirectWithFlash };
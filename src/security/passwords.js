const bcrypt = require('bcryptjs');
const { HttpError } = require('../utils/httpError');
function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || Buffer.byteLength(value, 'utf8') > 72) {
    throw new HttpError(422, 'Use a password of at least 12 characters and no more than 72 UTF-8 bytes.');
  }
  return value;
}
function verify(value, hash) {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 72 && bcrypt.compareSync(value, hash);
}
module.exports = { validatePassword, verify, hash: (value) => bcrypt.hashSync(validatePassword(value), 12) };

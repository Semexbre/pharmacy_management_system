class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true; // safe to show to the user
  }
}

module.exports = { HttpError };
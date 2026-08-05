// Wraps an async route so thrown errors hit the Express error handler.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Throw this for a clean HTTP error with a status code.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { ah, HttpError };

export function errorHandler(err, _req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const payload = {
    error: err.message || 'Internal Server Error',
  };

  if (err.fields) {
    payload.fields = err.fields;
  }

  if (status >= 500 && process.env.NODE_ENV !== 'test') {
    console.error(err);
  }

  res.status(status).json(payload);
}

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {Record<string, string>} [fields]
   */
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}
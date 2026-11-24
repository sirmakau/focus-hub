export class AppError extends Error {
  constructor(message, { statusCode = 500, code = 'INTERNAL_ERROR' } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = 'AppError';
  }
}

export function errorHandler(err, req, res, _next) {
  console.error('[error]', err);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
  }

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `No route matched ${req.method} ${req.path}`,
    },
  });
}

import { env } from '../config/env.js';
import { AppError } from './error-handler.js';

export function webhookAuth(req, res, next) {
  if (!env.telegram.webhookSecret) {
    console.warn(
      '[webhook-auth] TELEGRAM_WEBHOOK_SECRET is not set; skipping secret validation.'
    );
    return next();
  }

  const provided =
    req.headers['x-telegram-bot-api-secret-token'] ||
    req.query?.secret ||
    req.headers['x-telegram-webhook-secret'] ||
    '';

  if (provided !== env.telegram.webhookSecret) {
    const error = new AppError('Invalid webhook secret', {
      statusCode: 401,
      code: 'WEBHOOK_AUTH_FAILED',
    });
    return next(error);
  }

  next();
}

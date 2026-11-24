import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from './error-handler.js';

function secretMatches(provided, expected) {
  const providedBuffer = Buffer.from(String(provided));
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

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

  if (!secretMatches(provided, env.telegram.webhookSecret)) {
    const error = new AppError('Invalid webhook secret', {
      statusCode: 401,
      code: 'WEBHOOK_AUTH_FAILED',
    });
    return next(error);
  }

  next();
}

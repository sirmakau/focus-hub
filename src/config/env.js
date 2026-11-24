import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,

  telegram: {
    botToken: requireEnv('TELEGRAM_BOT_TOKEN'),
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
    authorizedUserIdStrings:
      process.env.AUTHORIZED_TELEGRAM_USER_IDS || '',
    get authorizedUserIds() {
      return this.authorizedUserIdStrings
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map(Number)
        .filter((n) => !Number.isNaN(n));
    },
  },

  database: {
    url: requireEnv('DATABASE_URL'),
  },

  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Africa/Nairobi',
};

export const isProduction = env.nodeEnv === 'production';
export const isDevelopment = env.nodeEnv === 'development';

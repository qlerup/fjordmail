import {z} from 'zod';
export const env = z.object({
  DATABASE_URL:z.string().min(1), APP_ENCRYPTION_KEY:z.string().min(32),
  PORT:z.coerce.number().int().min(1).max(65535).default(8101),
  COOKIE_SECURE:z.enum(['0','1']).default('0'),
  PUBLIC_URL:z.string().url().optional(), DEV_ORIGIN:z.string().url().optional(),
  FIRST_ADMIN_PASSWORD:z.string().min(12).optional(),
  FJORDHUB_URL:z.string().url().optional(), FJORDHUB_API_KEY:z.string().optional(),
  RESEND_API_KEY:z.string().optional(), RESEND_WEBHOOK_SECRET:z.string().optional(),
  MAIL_ENABLED:z.enum(['0','1']).default('0'),
  MAIL_STORAGE_ROOT:z.string().default('/mail-storage'),
  STALWART_URL:z.string().url().default('http://engine:8080'),
  STALWART_ADMIN_PASSWORD:z.string().min(32).optional(),
  RESEND_DOWNLOAD_HOSTS:z.string().default('inbound-cdn.resend.com,cdn.resend.app'),
  CLAMD_HOST:z.string().default('scanner'),
  CLAMD_PORT:z.coerce.number().default(3310),
}).parse(Object.fromEntries(Object.entries(process.env).filter(([,value])=>value!=='')));
if (!!env.FJORDHUB_URL !== !!env.FJORDHUB_API_KEY) throw Error('FjordHub URL og nøgle skal sættes sammen.');
export const managed = !!env.FJORDHUB_URL;

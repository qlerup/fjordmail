import {z} from 'zod';
export const env = z.object({
  DATABASE_URL:z.string().min(1), APP_ENCRYPTION_KEY:z.string().min(32),
  PORT:z.coerce.number().int().min(1).max(65535).default(8101),
  COOKIE_SECURE:z.enum(['0','1']).default('0'),
  PUBLIC_URL:z.string().url().optional(), DEV_ORIGIN:z.string().url().optional(),
  FIRST_ADMIN_PASSWORD:z.string().min(12).optional(),
  FJORDHUB_URL:z.string().url().optional(), FJORDHUB_API_KEY:z.string().optional(),
  RESEND_API_KEY:z.string().optional(), RESEND_WEBHOOK_SECRET:z.string().optional(),
}).parse(Object.fromEntries(Object.entries(process.env).filter(([,value])=>value!=='')));
if (!!env.FJORDHUB_URL !== !!env.FJORDHUB_API_KEY) throw Error('FjordHub URL og nøgle skal sættes sammen.');
export const managed = !!env.FJORDHUB_URL;

import {z} from 'zod';
export const mailId=z.string().min(1).max(200).regex(/^[A-Za-z0-9_.-]+$/);

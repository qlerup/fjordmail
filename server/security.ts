import {createCipheriv,createDecipheriv,createHash,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {env} from './config.js';
const derive = promisify(scrypt);
const key=createHash('sha256').update(env.APP_ENCRYPTION_KEY).digest();
export function seal(text:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(b=>b.toString('base64')).join('.');}
export function unseal(text:string){const [iv,tag,data]=text.split('.').map(s=>Buffer.from(s,'base64'));const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');}
export function digest(text:string){return createHash('sha256').update(text).digest('hex');}
export async function passwordHash(password:string){const salt=randomBytes(16).toString('hex');const hash=await derive(password,salt,64) as Buffer;return `scrypt:${salt}:${hash.toString('hex')}`;}
export async function checkPassword(password:string,hash:string){const [kind,salt,stored]=hash.split(':');if(kind!=='scrypt'||!salt||!stored)return false;const actual=await derive(password,salt,64) as Buffer;const expected=Buffer.from(stored,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}
export class PublicError extends Error {constructor(public status:number,message:string){super(message);}}

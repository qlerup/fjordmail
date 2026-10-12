import type {Request,Response,NextFunction} from 'express';
import {randomBytes} from 'node:crypto';
import {db} from './db.js';
import {env,managed} from './config.js';
import {digest,passwordHash,PublicError} from './security.js';
import {hubCall,hubIdentity} from './hub.js';
export type User={id:string;hub_id:number|null;username:string;email:string;role:'admin'|'user';preferences:Record<string,unknown>};
declare module 'express-serve-static-core' {interface Request {user?:User;csrf?:string;}}
export async function bootstrap(){if(!managed&&env.FIRST_ADMIN_PASSWORD){const hash=await passwordHash(env.FIRST_ADMIN_PASSWORD);await db.query("INSERT INTO users(username,role,password_hash) SELECT 'admin','admin',$1 WHERE NOT EXISTS(SELECT 1 FROM users) ON CONFLICT DO NOTHING",[hash]);}}
export async function session(res:Response,user:User){const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');await db.query("INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",[digest(token),user.id,csrf]);res.cookie('fjordmail_session',token,{httpOnly:true,sameSite:'lax',secure:env.COOKIE_SECURE==='1',path:'/',maxAge:8*3600000});return csrf;}
export function cookie(req:Request){return req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('fjordmail_session='))?.slice(18)||'';}
export async function syncHubUser(value:unknown){const user=hubIdentity.parse(value);if(user.email_required||user.must_change_password)throw new PublicError(403,'Afslut første login med email og personlig adgangskode.');
 return (await db.query("INSERT INTO users(hub_id,username,email,role) VALUES($1,$2,$3,$4) ON CONFLICT(hub_id) DO UPDATE SET username=excluded.username,email=excluded.email,role=excluded.role RETURNING id,hub_id,username,email,role,preferences",[user.id,user.username,user.email||'',user.role])).rows[0] as User;}
export async function authenticate(req:Request,_res:Response,next:NextFunction){
 const result=await db.query('SELECT u.id,u.hub_id,u.username,u.email,u.role,u.preferences,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now()',[digest(cookie(req))]);
 const row=result.rows[0];if(!row)throw new PublicError(401,'Log ind for at fortsætte.');
 if(managed){const items=(await hubCall('/api/hub/apps/users',{},'GET')).items;const current=Array.isArray(items)?items.find((u:Record<string,unknown>)=>u.id===Number(row.hub_id)):undefined;if(!current){await db.query('DELETE FROM sessions WHERE user_id=$1',[row.id]);throw new PublicError(401,'Din appadgang er fjernet.');}const profile=hubIdentity.parse(current);if(profile.must_change_password||profile.email_required)throw new PublicError(401,'Afslut første login igen.');row.role=profile.role;}
 req.user=row;req.csrf=row.csrf;
 if(!['GET','HEAD'].includes(req.method)&&req.headers['x-csrf-token']!==row.csrf)throw new PublicError(403,'Sikkerhedskontrollen fejlede. Genindlæs siden.');next();
}
export function admin(req:Request,_res:Response,next:NextFunction){if(req.user?.role!=='admin')throw new PublicError(403,'Denne handling kræver administratoradgang.');next();}
export async function audit(actor:string,action:string,target?:string){await db.query('INSERT INTO audit_log(actor_id,action,target) VALUES($1,$2,$3)',[actor,action,target||null]);}

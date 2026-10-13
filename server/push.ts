import express from 'express';
import webpush from 'web-push';
import {z} from 'zod';
import {db} from './db.js';
import {digest,PublicError,seal,unseal} from './security.js';
import {managed,env} from './config.js';
import {hubCall,hubIdentity} from './hub.js';
const hosts=new Set(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']);
export function pushEndpoint(value:string){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&hosts.has(url.hostname)&&url.pathname.length>1;}catch{return false;}}
const subscription=z.object({endpoint:z.string().url().max(3000).refine(pushEndpoint),expirationTime:z.number().nullable().optional(),keys:z.object({p256dh:z.string().regex(/^[A-Za-z0-9_-]{40,200}$/),auth:z.string().regex(/^[A-Za-z0-9_-]{16,100}$/)})});
async function keys(){let value=(await db.query("SELECT value_cipher FROM mail_system_settings WHERE id='vapid'")).rows[0];if(!value){const generated=webpush.generateVAPIDKeys();await db.query("INSERT INTO mail_system_settings(id,value_cipher) VALUES('vapid',$1) ON CONFLICT DO NOTHING",[seal(JSON.stringify(generated))]);value=(await db.query("SELECT value_cipher FROM mail_system_settings WHERE id='vapid'")).rows[0];}return JSON.parse(unseal(value.value_cipher)) as {publicKey:string;privateKey:string};}
export function pushRoutes(){const router=express.Router();
 router.get('/key',async(_req,res)=>res.json({publicKey:(await keys()).publicKey}));
 router.post('/subscriptions',async(req,res)=>{if(!env.PUBLIC_URL?.startsWith('https://'))throw new PublicError(409,'Konfigurér FjordMails offentlige HTTPS-adresse før pushnotifikationer.');const data=subscription.parse(req.body);const key=digest(data.endpoint);const existing=(await db.query('SELECT user_id FROM mail_push_subscriptions WHERE endpoint_digest=$1',[key])).rows[0];if(existing&&existing.user_id!==req.user!.id)throw new PublicError(409,'Denne browser er allerede tilknyttet en anden bruger. Slå notifikationer fra dér først.');if((await db.query('SELECT count(*)::int AS n FROM mail_push_subscriptions WHERE user_id=$1',[req.user!.id])).rows[0].n>=10&&!existing)throw new PublicError(409,'Højst 10 enheder kan få notifikationer.');await db.query('INSERT INTO mail_push_subscriptions(user_id,endpoint_digest,subscription_cipher) VALUES($1,$2,$3) ON CONFLICT(endpoint_digest) DO UPDATE SET subscription_cipher=excluded.subscription_cipher',[req.user!.id,key,seal(JSON.stringify(data))]);res.status(201).json({ok:true});});
 router.delete('/subscriptions',async(req,res)=>{const {endpoint}=z.object({endpoint:z.string().max(3000)}).parse(req.body);await db.query('DELETE FROM mail_push_subscriptions WHERE user_id=$1 AND endpoint_digest=$2',[req.user!.id,digest(endpoint)]);res.json({ok:true});});return router;
}
export async function notifyMailbox(payload:{mailboxId:string}){
 const rows=(await db.query("SELECT p.*,u.hub_id,u.preferences FROM mail_push_subscriptions p JOIN users u ON u.id=p.user_id JOIN mailbox_members m ON m.user_id=u.id WHERE m.mailbox_id=$1 AND u.preferences->>'notifications'='true'",[payload.mailboxId])).rows;
 let members:Set<number>|null=null;if(managed&&rows.length){const values=(await hubCall('/api/hub/apps/users',{},'GET')).items as unknown[];members=new Set(values.map(v=>hubIdentity.parse(v)).filter(v=>!v.email_required&&!v.must_change_password).map(v=>v.id));}
 if(!rows.length)return;const key=await keys();for(const row of rows){if(members&&!members.has(Number(row.hub_id)))continue;const selected=row.preferences.notificationMailboxes;if(Array.isArray(selected)&&!selected.includes(payload.mailboxId))continue;
  const data=subscription.parse(JSON.parse(unseal(row.subscription_cipher)));try{await webpush.sendNotification(data,JSON.stringify({title:'FjordMail',body:'Der er kommet ny post.',url:'/',tag:'fjordmail-'+payload.mailboxId}),{TTL:300,timeout:15000,vapidDetails:{subject:env.PUBLIC_URL||'mailto:admin@example.invalid',...key}});}catch(error){const status=error instanceof webpush.WebPushError?error.statusCode:0;if([404,410].includes(status))await db.query('DELETE FROM mail_push_subscriptions WHERE id=$1',[row.id]);else throw Error('push_delivery_failed');}
 }
}

import express from 'express';
import {z} from 'zod';
import {db} from './db.js';
import {PublicError,seal,unseal} from './security.js';
import {audit} from './auth.js';
import {jmap,folders,mailboxAuth,type EngineRow} from './engine.js';
import {mailId} from './ids.js';
const uuid=z.string().uuid(),local=z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._+-]{0,63}$/);
export async function allowedSender(row:EngineRow,address?:string){
 const primary=row.local_part+'@'+row.domain;const value=address||primary;if(value.toLowerCase()===primary)return primary;
 const alias=(await db.query("SELECT a.local_part||'@'||d.name AS address FROM mail_aliases a JOIN domains d ON d.id=a.domain_id WHERE a.mailbox_id=$1 AND lower(a.local_part||'@'||d.name)=lower($2) AND d.sending_status IN('enabled','verified')",[row.id,value])).rows[0];
 if(!alias)throw new PublicError(403,'Afsenderadressen er ikke godkendt til denne mailkonto.');return alias.address as string;
}
export function routingAdminRoutes(){const router=express.Router();
 router.get('/aliases',async(_req,res)=>{res.json({items:(await db.query("SELECT a.id,a.domain_id,a.local_part,a.mailbox_id,d.name AS domain,m.display_name FROM mail_aliases a JOIN domains d ON d.id=a.domain_id JOIN mailboxes m ON m.id=a.mailbox_id ORDER BY d.name,a.local_part")).rows});});
 router.post('/aliases',async(req,res)=>{const data=z.object({domainId:uuid,localPart:local,mailboxId:uuid}).parse(req.body);const client=await db.connect();try{await client.query('BEGIN');await client.query('SELECT id FROM domains WHERE id=$1 FOR UPDATE',[data.domainId]);if((await client.query('SELECT 1 FROM mailboxes WHERE domain_id=$1 AND local_part=$2',[data.domainId,data.localPart])).rowCount)throw new PublicError(409,'Adressen er allerede en mailkonto.');const result=await client.query('INSERT INTO mail_aliases(domain_id,local_part,mailbox_id) VALUES($1,$2,$3) RETURNING id',[data.domainId,data.localPart,data.mailboxId]);await client.query('COMMIT');await audit(req.user!.id,'alias.create',result.rows[0].id);res.status(201).json({id:result.rows[0].id});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}});
 router.delete('/aliases/:aliasId',async(req,res)=>{const id=uuid.parse(req.params.aliasId);await db.query('DELETE FROM mail_aliases WHERE id=$1',[id]);await audit(req.user!.id,'alias.delete',id);res.json({ok:true});});
 router.put('/domains/:domainId/catch-all',async(req,res)=>{const id=uuid.parse(req.params.domainId),data=z.object({mailboxId:uuid.nullable()}).parse(req.body);const result=await db.query('UPDATE domains SET catch_all_mailbox_id=$1 WHERE id=$2',[data.mailboxId,id]);if(!result.rowCount)throw new PublicError(404,'Domænet findes ikke.');await audit(req.user!.id,'domain.catch_all',id);res.json({ok:true});});
 return router;
}
const rule=z.object({name:z.string().trim().min(1).max(80),match:z.object({from:z.string().max(254).default(''),subject:z.string().max(300).default('')}).refine(v=>v.from||v.subject),action:z.object({folderId:mailId.optional(),labelId:uuid.optional()}).refine(v=>v.folderId||v.labelId),enabled:z.boolean().default(true)});
export function routingRoutes(access:(req:express.Request,write?:boolean)=>Promise<EngineRow>){const router=express.Router();
 router.get('/:id/forwarding',async(req,res)=>{const row=await access(req,true),value=(await db.query('SELECT * FROM mail_forwarding WHERE mailbox_id=$1',[row.id])).rows[0];res.json({enabled:!!value?.enabled,recipient:value?unseal(value.recipient_cipher):''});});
 router.put('/:id/forwarding',async(req,res)=>{const row=await access(req,true),data=z.object({enabled:z.boolean(),recipient:z.string().email().max(254)}).parse(req.body);if(data.recipient.toLowerCase()===row.local_part+'@'+row.domain)throw new PublicError(400,'Videresend ikke til samme mailkonto.');await db.query('INSERT INTO mail_forwarding(mailbox_id,actor_id,recipient_cipher,enabled) VALUES($1,$2,$3,$4) ON CONFLICT(mailbox_id) DO UPDATE SET actor_id=excluded.actor_id,recipient_cipher=excluded.recipient_cipher,enabled=excluded.enabled',[row.id,req.user!.id,seal(data.recipient),data.enabled]);await audit(req.user!.id,'mail.forwarding',row.id);res.json({ok:true});});
 router.get('/:id/rules',async(req,res)=>{const row=await access(req,true);const values=(await db.query('SELECT * FROM mail_rules WHERE mailbox_id=$1 ORDER BY created_at',[row.id])).rows;res.json({items:values.map(v=>({id:v.id,name:v.name,enabled:v.enabled,match:JSON.parse(unseal(v.match_cipher)),action:JSON.parse(unseal(v.action_cipher))}))});});
 router.post('/:id/rules',async(req,res)=>{const row=await access(req,true),data=rule.parse(req.body);if(data.action.folderId&&!(await folders(row)).some(f=>f.id===data.action.folderId&&f.role!=='drafts'))throw new PublicError(400,'Vælg en eksisterende mappe.');if(data.action.labelId&&!(await db.query('SELECT 1 FROM mail_labels WHERE id=$1 AND mailbox_id=$2',[data.action.labelId,row.id])).rowCount)throw new PublicError(400,'Vælg en eksisterende label.');const r=await db.query('INSERT INTO mail_rules(mailbox_id,actor_id,name,match_cipher,action_cipher,enabled) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[row.id,req.user!.id,data.name,seal(JSON.stringify(data.match)),seal(JSON.stringify(data.action)),data.enabled]);res.status(201).json(r.rows[0]);});
 router.delete('/:id/rules/:ruleId',async(req,res)=>{const row=await access(req,true);await db.query('DELETE FROM mail_rules WHERE id=$1 AND mailbox_id=$2',[uuid.parse(req.params.ruleId),row.id]);res.json({ok:true});});
 return router;
}
export async function applyRules(row:EngineRow,id:string){
 const rules=(await db.query("SELECT r.* FROM mail_rules r JOIN mailbox_members m ON m.mailbox_id=r.mailbox_id AND m.user_id=r.actor_id AND m.permission='write' WHERE r.mailbox_id=$1 AND r.enabled ORDER BY r.created_at",[row.id])).rows;if(!rules.length)return;
 const value=(await jmap('Email/get',{accountId:row.engine_id,ids:[id],properties:['id','from','subject','mailboxIds']},mailboxAuth(row))).list as {from:{email:string}[];subject:string;mailboxIds:Record<string,boolean>}[];const email=value[0];if(!email)return;
 const boxes=await folders(row),patch:Record<string,unknown>={};let destination:string|undefined;
 for(const record of rules){const match=JSON.parse(unseal(record.match_cipher)),action=JSON.parse(unseal(record.action_cipher));if(match.from&&!email.from?.some(f=>f.email.toLowerCase().includes(match.from.toLowerCase())))continue;if(match.subject&&!email.subject.toLowerCase().includes(match.subject.toLowerCase()))continue;
  if(action.folderId&&boxes.some(b=>b.id===action.folderId&&b.role!=='drafts'))destination=action.folderId;
  if(action.labelId&&(await db.query('SELECT 1 FROM mail_labels WHERE id=$1 AND mailbox_id=$2',[action.labelId,row.id])).rowCount)patch['keywords/fm-label-'+action.labelId]=true;
 }
 if(destination){for(const folder of Object.keys(email.mailboxIds))if(folder!==destination)patch['mailboxIds/'+folder]=null;patch['mailboxIds/'+destination]=true;}
 if(Object.keys(patch).length){const r=await jmap('Email/set',{accountId:row.engine_id,update:{[id]:patch}},mailboxAuth(row));if(r.notUpdated&&Object.keys(r.notUpdated as object).length)throw Error('mail_rule_failed');}
}

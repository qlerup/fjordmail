import express from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import sanitizeHtml from 'sanitize-html';
import rateLimit from 'express-rate-limit';
import {db} from './db.js';
import {PublicError,seal} from './security.js';
import {requireStorage,processingReady,storageReady} from './storage.js';
import {provision,folders,jmap,mailboxAuth,message,type EngineRow} from './engine.js';
import {providerConfig,verifyEvent} from './provider.js';
import {enqueue} from './queue.js';

const uuid=z.string().uuid();
async function access(req:express.Request,write=false):Promise<EngineRow>{
 const id=uuid.parse(req.params.id);const rows=await db.query('SELECT m.*,d.name AS domain,a.permission FROM mailboxes m JOIN domains d ON d.id=m.domain_id JOIN mailbox_members a ON a.mailbox_id=m.id WHERE m.id=$1 AND a.user_id=$2',[id,req.user!.id]);
 if(!rows.rowCount)throw new PublicError(404,'Mailkontoen findes ikke eller er ikke tildelt dig.');if(write&&rows.rows[0].permission!=='write')throw new PublicError(403,'Du har kun læseadgang til denne konto.');await requireStorage();return await provision(id);
}
export async function webhook(req:express.Request,res:express.Response){
 if(!await processingReady())throw new PublicError(503,'Modtagelse er ikke aktiveret endnu.');
 const config=await providerConfig();if(!config.secret)throw new PublicError(503,'Webhook-nøglen mangler.');
 let event:unknown;try{event=verifyEvent(req.body,{'svix-id':req.get('svix-id')||'','svix-timestamp':req.get('svix-timestamp')||'','svix-signature':req.get('svix-signature')||''},config.secret);}catch{throw new PublicError(401,'Webhook-signaturen er ugyldig.');}
 const value=z.object({type:z.string(),data:z.object({email_id:uuid})}).parse(event);const eventId=z.string().min(1).max(200).parse(req.get('svix-id'));
 if(value.type==='email.received')await enqueue('receive','resend-event:'+eventId,{emailId:value.data.email_id});
 else if(['email.delivered','email.bounced','email.failed'].includes(value.type))await enqueue('delivery','resend-event:'+eventId,{type:value.type,emailId:value.data.email_id});
 res.status(202).json({ok:true});
}
export function mailRoutes(){
 const router=express.Router();
 router.get('/:id/messages',async(req,res)=>{
  const row=await access(req);const role=z.enum(['inbox','sent','drafts','archive','junk','trash']).default('inbox').parse(req.query.folder);const position=z.coerce.number().int().min(0).max(1000000).default(0).parse(req.query.position);
  const list=await folders(row);const box=list.find(f=>f.role===role);if(!box){res.json({items:[],total:0,folders:list});return;}
  const query=await jmap('Email/query',{accountId:row.engine_id,filter:{inMailbox:box.id},sort:[{property:'receivedAt',isAscending:false}],position,limit:50,calculateTotal:true},mailboxAuth(row));
  const result=await jmap('Email/get',{accountId:row.engine_id,ids:query.ids,properties:['id','threadId','subject','from','to','receivedAt','preview','keywords','hasAttachment']},mailboxAuth(row));res.json({items:result.list,total:query.total,folders:list});
 });
 router.get('/:id/messages/:messageId',async(req,res)=>{
  const row=await access(req);const id=z.string().min(1).max(200).parse(req.params.messageId);const value=await message(row,id);
  const bodies=value.bodyValues as Record<string,{value:string}>;const textParts=value.textBody as {partId:string}[];const htmlParts=value.htmlBody as {partId:string}[];
  const text=(textParts||[]).map(p=>bodies?.[p.partId]?.value||'').join('\n')||sanitizeHtml((htmlParts||[]).map(p=>bodies?.[p.partId]?.value||'').join('\n'),{allowedTags:[],allowedAttributes:{}});
  // Basic reader deliberately shows text; sender HTML cannot run scripts or tracking images.
  res.json({id:value.id,subject:value.subject,from:value.from,to:value.to,cc:value.cc,receivedAt:value.receivedAt,text,attachments:value.attachments,keywords:value.keywords});
 });
 router.post('/:id/send',rateLimit({windowMs:3600000,limit:30,keyGenerator:req=>req.user!.id,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'For mange afsendelser. Prøv igen senere.'}}),async(req,res)=>{
  const row=await access(req,true);if(!await processingReady())throw new PublicError(503,'Aktivér først mailbehandling under Administration → Maildrift.');
  const data=z.object({requestKey:uuid,to:z.array(z.string().email().max(254)).min(1).max(20),subject:z.string().max(998).refine(v=>!/[\r\n]/.test(v)),text:z.string().min(1).max(40000)}).parse(req.body);
  const existing=(await db.query('SELECT id,mailbox_id FROM mail_submissions WHERE actor_id=$1 AND request_key=$2',[req.user!.id,data.requestKey])).rows[0];if(existing){if(existing.mailbox_id!==row.id)throw new PublicError(409,'Anmodningen tilhører en anden mailkonto.');res.json({id:existing.id,state:'queued'});return;}
  const domain=(await db.query('SELECT sending_status FROM domains WHERE id=(SELECT domain_id FROM mailboxes WHERE id=$1)',[row.id])).rows[0];if(!['enabled','verified'].includes(domain.sending_status))throw new PublicError(409,'Kontrollér først domænets afsendelse under Resend.');
  const id=randomUUID(),messageId='<'+id+'@'+row.domain+'>';const from=row.local_part+'@'+row.domain;
  const raw=await new MailComposer({from,to:data.to,subject:data.subject,text:data.text,messageId,date:new Date()}).compile().build();
  const payload={provider:{from,to:data.to,subject:data.subject,text:data.text,headers:{'Message-ID':messageId}},raw:raw.toString('base64'),messageId};
  const client=await db.connect();try{await client.query('BEGIN');const result=await client.query("INSERT INTO mail_submissions(id,mailbox_id,actor_id,request_key,draft_id,payload_cipher) VALUES($1,$2,$3,$4,'',$5) ON CONFLICT(actor_id,request_key) DO NOTHING RETURNING id",[id,row.id,req.user!.id,data.requestKey,seal(JSON.stringify(payload))]);
   if(result.rowCount)await client.query('INSERT INTO jobs(kind,dedupe_key,payload) VALUES(\'send\',$1,$2)', ['send:'+id,JSON.stringify({cipher:seal(JSON.stringify({submissionId:id}))})]);await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  const item=(await db.query('SELECT id,state FROM mail_submissions WHERE actor_id=$1 AND request_key=$2',[req.user!.id,data.requestKey])).rows[0];res.status(202).json(item);
 });
 router.get('/:id/submissions/:submissionId',async(req,res)=>{const row=await access(req);const id=uuid.parse(req.params.submissionId);const item=(await db.query('SELECT id,state,last_error_code,sent_id FROM mail_submissions WHERE id=$1 AND mailbox_id=$2 AND actor_id=$3',[id,row.id,req.user!.id])).rows[0];if(!item)throw new PublicError(404,'Afsendelsen findes ikke.');res.json(item);});
 return router;
}
export function mailAdminRoutes(){const router=express.Router();
 router.get('/',async(_req,res)=>{res.json({storageReady:await storageReady(),enabled:await processingReady(),jobs:(await db.query('SELECT kind,state,count(*) AS count FROM jobs GROUP BY kind,state')).rows,failures:(await db.query("SELECT id,kind,last_error_code,attempts,created_at FROM jobs WHERE state='dead' ORDER BY created_at DESC LIMIT 20")).rows});});
 router.post('/enable',async(_req,res)=>{await requireStorage();const config=await providerConfig();if(!config.key)throw new PublicError(409,'Gem Resend API-nøglen først.');await db.query('UPDATE mail_controls SET enabled=true WHERE id=true');res.json({ok:true});});
 router.post('/pause',async(_req,res)=>{await db.query('UPDATE mail_controls SET enabled=false WHERE id=true');res.json({ok:true});});
 return router;
}

import express from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import rateLimit from 'express-rate-limit';
import {db} from './db.js';
import {PublicError,seal,unseal} from './security.js';
import {requireStorage,processingReady,storageReady} from './storage.js';
import {provision,jmap,mailboxAuth,message,upload,blob,type EngineRow} from './engine.js';
import {providerConfig,verifyEvent} from './provider.js';
import {enqueue} from './queue.js';
import {scan} from './scanner.js';
import {composition,bodyText,descriptor,fileName,buildComposition,mailId,type Part} from './composition.js';
import {messageHtml,htmlDocument} from './html.js';
import {operationsRoutes} from './operations.js';
import {routingRoutes} from './routing.js';
import {organizationRoutes,querySchema,searchFilter} from './organization.js';
import {saveDraft,discardDraft,draftContent,ownDraft,type Draft} from './drafts.js';

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
 router.use(organizationRoutes(access));
 router.use(routingRoutes(access));
 router.post('/:id/uploads',rateLimit({windowMs:3600000,limit:100,keyGenerator:req=>req.user!.id,standardHeaders:'draft-8',legacyHeaders:false}),express.raw({type:'application/octet-stream',limit:'10mb'}),async(req,res)=>{
  const row=await access(req,true);if(!Buffer.isBuffer(req.body)||req.body.length>10000000)throw new PublicError(400,'Filen skal sendes som filindhold og højst fylde 10 MB.');
  const name=fileName(z.string().min(1).max(255).parse(req.query.name));const type=z.string().max(127).regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/).default('application/octet-stream').parse(req.query.type);
  await scan(req.body);const value=await upload(row,req.body,type);res.status(201).json(descriptor(row,req.user!.id,{partId:'',blobId:value.blobId,name,type,size:req.body.length}));
 });
 router.get('/:id/messages/:messageId/attachments/:partId',async(req,res)=>{
  const row=await access(req);const value=await message(row,mailId.parse(req.params.messageId));const part=(value.attachments as Part[]||[]).find(p=>p.partId===req.params.partId);
  if(!part)throw new PublicError(404,'Vedhæftningen findes ikke.');const content=await blob(row,part.blobId);await scan(content);
  res.set({'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(fileName(part.name||'vedhaeftning')),'Cache-Control':'no-store'}).send(content);
 });
 router.put('/:id/drafts/:draftId',async(req,res)=>{const row=await access(req,true);const id=uuid.parse(req.params.draftId);const data=composition.parse(req.body);const revision=z.number().int().positive().parse(req.body.revision);res.json(await saveDraft(row,req.user!.id,id,revision,data));});
 router.get('/:id/drafts/:draftId',async(req,res)=>{const row=await access(req,true);const draft=(await db.query('SELECT * FROM mail_drafts WHERE id=$1',[uuid.parse(req.params.draftId)])).rows[0] as Draft|undefined;ownDraft(draft,row,req.user!.id);res.json(await draftContent(row,req.user!.id,draft));});
 router.delete('/:id/drafts/:draftId',async(req,res)=>{const row=await access(req,true);await discardDraft(row,req.user!.id,uuid.parse(req.params.draftId));res.json({ok:true});});
 router.get('/:id/messages',async(req,res)=>{
  const row=await access(req);const search=querySchema.parse(req.query);const role=search.folder,position=search.position;
  if(role==='drafts'){
   const drafts=(await db.query("SELECT id,engine_message_id FROM mail_drafts WHERE mailbox_id=$1 AND owner_id=$2 AND state='editing' AND engine_message_id IS NOT NULL ORDER BY updated_at DESC LIMIT 50 OFFSET $3",[row.id,req.user!.id,position])).rows;
   const total=(await db.query("SELECT count(*)::int AS total FROM mail_drafts WHERE mailbox_id=$1 AND owner_id=$2 AND state='editing' AND engine_message_id IS NOT NULL",[row.id,req.user!.id])).rows[0].total;
   const result=drafts.length?await jmap('Email/get',{accountId:row.engine_id,ids:drafts.map(d=>d.engine_message_id),properties:['id','subject','from','to','receivedAt','preview','keywords','hasAttachment']},mailboxAuth(row)):{list:[]};
   res.json({items:(result.list as {id:string}[]).map(item=>({...item,draftId:drafts.find(d=>d.engine_message_id===item.id)!.id})),total});return;
  }
  const {boxes:list,filter}=await searchFilter(row,search);if(!filter){res.json({items:[],total:0,folders:list});return;}
  const query=await jmap('Email/query',{accountId:row.engine_id,filter,sort:[{property:'receivedAt',isAscending:false}],position,limit:50,calculateTotal:true},mailboxAuth(row));
  const result=await jmap('Email/get',{accountId:row.engine_id,ids:query.ids,properties:['id','threadId','subject','from','to','receivedAt','preview','keywords','hasAttachment']},mailboxAuth(row));const values=result.list as {id:string}[];res.json({items:(query.ids as string[]).map(id=>values.find(v=>v.id===id)).filter(Boolean),total:query.total,folders:list});
 });
 router.get('/:id/messages/:messageId/html',async(req,res)=>{const row=await access(req);const value=await message(row,mailId.parse(req.params.messageId));const images=req.query.images==='1';res.set({'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src "+(images?"https:":"'none'")+"; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox allow-popups allow-popups-to-escape-sandbox",'X-Frame-Options':'SAMEORIGIN','Cache-Control':'no-store'}).send(htmlDocument(messageHtml(value),images));});
 router.get('/:id/messages/:messageId',async(req,res)=>{
  const row=await access(req);const id=z.string().min(1).max(200).parse(req.params.messageId);const value=await message(row,id);const receipt=(await db.query('SELECT authentication_cipher FROM mail_receipts WHERE mailbox_id=$1 AND engine_message_id=$2',[row.id,id])).rows[0];
  res.json({id:value.id,subject:value.subject,from:value.from,to:value.to,cc:value.cc,bcc:value.bcc,headers:value.headers,threadId:value.threadId,replyTo:value.replyTo,receivedAt:value.receivedAt,text:bodyText(value),hasHtml:!!messageHtml(value),authentication:receipt?.authentication_cipher?JSON.parse(unseal(receipt.authentication_cipher)):null,attachments:(value.attachments as Part[]||[]).map(p=>descriptor(row,req.user!.id,p)),keywords:value.keywords});
 });
 router.post('/:id/send',rateLimit({windowMs:3600000,limit:30,keyGenerator:req=>req.user!.id,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'For mange afsendelser. Prøv igen senere.'}}),async(req,res)=>{
  const row=await access(req,true);if(!await processingReady())throw new PublicError(503,'Aktivér først mailbehandling under Administration → Maildrift.');
  const request=z.object({requestKey:uuid,draftId:uuid.optional(),draftRevision:z.number().int().positive().optional()}).parse(req.body);
  const existing=(await db.query('SELECT id,mailbox_id,state FROM mail_submissions WHERE actor_id=$1 AND request_key=$2',[req.user!.id,request.requestKey])).rows[0];if(existing){if(existing.mailbox_id!==row.id)throw new PublicError(409,'Anmodningen tilhører en anden mailkonto.');res.json({id:existing.id,state:existing.state});return;}
  const domain=(await db.query('SELECT sending_status FROM domains WHERE id=(SELECT domain_id FROM mailboxes WHERE id=$1)',[row.id])).rows[0];if(!['enabled','verified'].includes(domain.sending_status))throw new PublicError(409,'Kontrollér først domænets afsendelse under Resend.');
  const client=await db.connect();try{await client.query('BEGIN');
   // Serialize identical sends even when the first response is lost.
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[req.user!.id+request.requestKey]);
   const retry=(await client.query('SELECT id,mailbox_id,state FROM mail_submissions WHERE actor_id=$1 AND request_key=$2',[req.user!.id,request.requestKey])).rows[0];
   if(retry){if(retry.mailbox_id!==row.id)throw new PublicError(409,'Anmodningen tilhører en anden mailkonto.');await client.query('COMMIT');res.json({id:retry.id,state:retry.state});return;}
   let draft:Draft|undefined;
   if(request.draftId){draft=(await client.query('SELECT * FROM mail_drafts WHERE id=$1 FOR UPDATE',[request.draftId])).rows[0];ownDraft(draft,row,req.user!.id);if(draft.revision!==request.draftRevision)throw new PublicError(409,'Gem kladden igen før afsendelse.');}
   const data=composition.parse(draft?await draftContent(row,req.user!.id,draft):req.body);
   if(!data.to.length)throw new PublicError(400,'Angiv mindst én modtager.');if(!data.text.trim()&&!data.attachments.length)throw new PublicError(400,'Skriv en besked eller vedhæft en fil.');
   const id=randomUUID(),messageId='<'+id+'@'+row.domain+'>';const built=await buildComposition(row,req.user!.id,data,messageId);
   const payload={provider:built.provider,raw:built.raw.toString('base64'),messageId};
   await client.query('INSERT INTO mail_submissions(id,mailbox_id,actor_id,request_key,draft_id,app_draft_id,payload_cipher) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,row.id,req.user!.id,request.requestKey,draft?.engine_message_id||'',draft?.id||null,seal(JSON.stringify(payload))]);
   await client.query("INSERT INTO jobs(kind,dedupe_key,payload) VALUES('send',$1,$2)", ['send:'+id,JSON.stringify({cipher:seal(JSON.stringify({submissionId:id}))})]);
   if(draft)await client.query("UPDATE mail_drafts SET state='queued',updated_at=now() WHERE id=$1",[draft.id]);
   await client.query('COMMIT');res.status(202).json({id,state:'queued'});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 });
 router.get('/:id/submissions/:submissionId',async(req,res)=>{const row=await access(req);const id=uuid.parse(req.params.submissionId);const item=(await db.query('SELECT id,state,last_error_code,sent_id FROM mail_submissions WHERE id=$1 AND mailbox_id=$2 AND actor_id=$3',[id,row.id,req.user!.id])).rows[0];if(!item)throw new PublicError(404,'Afsendelsen findes ikke.');res.json(item);});
 return router;
}
export function mailAdminRoutes(){const router=express.Router();router.use(operationsRoutes());
 router.get('/',async(_req,res)=>{res.json({storageReady:await storageReady(),enabled:await processingReady(),jobs:(await db.query('SELECT kind,state,count(*) AS count FROM jobs GROUP BY kind,state')).rows,failures:(await db.query("SELECT id,kind,last_error_code,attempts,created_at FROM jobs WHERE state='dead' ORDER BY created_at DESC LIMIT 20")).rows});});
 router.post('/enable',async(_req,res)=>{await requireStorage();const config=await providerConfig();if(!config.key)throw new PublicError(409,'Gem Resend API-nøglen først.');await db.query('UPDATE mail_controls SET enabled=true WHERE id=true');res.json({ok:true});});
 router.post('/pause',async(_req,res)=>{await db.query('UPDATE mail_controls SET enabled=false WHERE id=true');res.json({ok:true});});
 return router;
}

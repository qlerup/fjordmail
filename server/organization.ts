import express from 'express';
import {z} from 'zod';
import {db} from './db.js';
import {audit,authenticate} from './auth.js';
import {PublicError,seal,unseal} from './security.js';
import {jmap,mailboxAuth,folders,type EngineRow} from './engine.js';
import {mailId} from './composition.js';

type Access=(req:express.Request,write?:boolean)=>Promise<EngineRow>;
const uuid=z.string().uuid();
const name=z.string().trim().min(1).max(80).refine(v=>!/[\x00-\x1f\x7f]/.test(v));
const roles=['inbox','sent','drafts','archive','junk','trash','starred'] as const;
export const querySchema=z.object({
 folder:z.enum(roles).default('inbox'),folderId:mailId.optional(),position:z.coerce.number().int().min(0).max(1000000).default(0),
 q:z.string().trim().max(300).optional(),from:z.string().max(254).optional(),to:z.string().max(254).optional(),subject:z.string().max(300).optional(),
 after:z.string().datetime().optional(),before:z.string().datetime().optional(),unread:z.enum(['0','1']).optional(),attachment:z.enum(['0','1']).optional(),label:uuid.optional()
});
export async function searchFilter(row:EngineRow,query:z.infer<typeof querySchema>){
 const boxes=await folders(row),filter:Record<string,unknown>={};
 if(query.folderId){if(!boxes.some(f=>f.id===query.folderId))throw new PublicError(404,'Mappen findes ikke.');filter.inMailbox=query.folderId;}
 else if(query.folder==='starred')filter.hasKeyword='$flagged';
 else{const box=boxes.find(f=>f.role===query.folder);if(!box)return {boxes,filter:null};filter.inMailbox=box.id;}
 if(query.q)filter.text=query.q;if(query.from)filter.from=query.from;if(query.to)filter.to=query.to;if(query.subject)filter.subject=query.subject;
 if(query.after)filter.after=query.after;if(query.before)filter.before=query.before;
 if(query.attachment)filter.hasAttachment=query.attachment==='1';
 const conditions:Record<string,unknown>[]=[filter];
 if(query.unread)conditions.push(query.unread==='1'?{notKeyword:'$seen'}:{hasKeyword:'$seen'});
 if(query.label){const label=(await db.query('SELECT id FROM mail_labels WHERE id=$1 AND mailbox_id=$2',[query.label,row.id])).rows[0];if(!label)throw new PublicError(404,'Labelen findes ikke.');conditions.push({hasKeyword:'fm-label-'+label.id});}
 return {boxes,filter:conditions.length===1?filter:{operator:'AND',conditions}};
}
function checkedSet(result:Record<string,unknown>,property:string){if(result[property]&&Object.keys(result[property] as object).length)throw new PublicError(409,'Handlingen kunne ikke udføres på alle elementer. Opdatér listen og prøv igen.');}
const streams=new Map<string,number>();
const activeStreams=new Set<express.Response>();
export function closeMailStreams(){for(const response of activeStreams)response.end();}
export function organizationRoutes(access:Access){
 const router=express.Router();
 router.get('/:id/folders',async(req,res)=>{const row=await access(req);res.json({items:await folders(row)});});
 router.post('/:id/folders',async(req,res)=>{const row=await access(req,true);const data=z.object({name,parentId:mailId.nullable().default(null)}).parse(req.body);if(data.parentId&&!(await folders(row)).some(f=>f.id===data.parentId))throw new PublicError(404,'Overmappen findes ikke.');const result=await jmap('Mailbox/set',{accountId:row.engine_id,create:{folder:{name:data.name,parentId:data.parentId}}},mailboxAuth(row));checkedSet(result,'notCreated');res.status(201).json({items:await folders(row)});});
 router.patch('/:id/folders/:folderId',async(req,res)=>{const row=await access(req,true),id=mailId.parse(req.params.folderId);const box=(await folders(row)).find(f=>f.id===id);if(!box||box.role)throw new PublicError(409,'Kun egne mapper kan omdøbes.');const data=z.object({name}).parse(req.body);checkedSet(await jmap('Mailbox/set',{accountId:row.engine_id,update:{[id]:{name:data.name}}},mailboxAuth(row)),'notUpdated');res.json({ok:true});});
 router.delete('/:id/folders/:folderId',async(req,res)=>{const row=await access(req,true),id=mailId.parse(req.params.folderId);const list=await folders(row),box=list.find(f=>f.id===id);if(!box||box.role)throw new PublicError(409,'Kun egne mapper kan slettes.');if(box.totalEmails)throw new PublicError(409,'Flyt først mails ud af mappen.');checkedSet(await jmap('Mailbox/set',{accountId:row.engine_id,destroy:[id],onDestroyRemoveEmails:false},mailboxAuth(row)),'notDestroyed');res.json({ok:true});});
 router.get('/:id/labels',async(req,res)=>{const row=await access(req);res.json({items:(await db.query('SELECT id,name,color FROM mail_labels WHERE mailbox_id=$1 ORDER BY name',[row.id])).rows});});
 router.post('/:id/labels',async(req,res)=>{const row=await access(req,true);const data=z.object({name,color:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#75d5dc')}).parse(req.body);res.status(201).json((await db.query('INSERT INTO mail_labels(mailbox_id,name,color) VALUES($1,$2,$3) RETURNING id,name,color',[row.id,data.name,data.color])).rows[0]);});
 router.patch('/:id/labels/:labelId',async(req,res)=>{const row=await access(req,true);const data=z.object({name,color:z.string().regex(/^#[0-9a-fA-F]{6}$/)}).parse(req.body);const r=await db.query('UPDATE mail_labels SET name=$1,color=$2 WHERE id=$3 AND mailbox_id=$4',[data.name,data.color,uuid.parse(req.params.labelId),row.id]);if(!r.rowCount)throw new PublicError(404,'Labelen findes ikke.');res.json({ok:true});});
 router.delete('/:id/labels/:labelId',async(req,res)=>{const row=await access(req,true);await db.query('DELETE FROM mail_labels WHERE id=$1 AND mailbox_id=$2',[uuid.parse(req.params.labelId),row.id]);res.json({ok:true});});
 router.post('/:id/actions',async(req,res)=>{
  const row=await access(req,true);const data=z.object({ids:z.array(mailId).min(1).max(100),action:z.enum(['read','unread','star','unstar','archive','trash','spam','move','label','unlabel','delete']),folderId:mailId.optional(),labelId:uuid.optional()}).parse(req.body);const ids=[...new Set(data.ids)];
  const boxes=await folders(row),result=await jmap('Email/get',{accountId:row.engine_id,ids,properties:['id','mailboxIds','keywords']},mailboxAuth(row));
  const emails=result.list as {id:string;mailboxIds:Record<string,boolean>;keywords:Record<string,boolean>}[];
  if(emails.length!==ids.length)throw new PublicError(404,'En eller flere mails findes ikke.');
  if(emails.some(e=>e.keywords.$draft))throw new PublicError(409,'Administrér kladder fra skrivevinduet.');
  if(data.action==='delete'){const trash=boxes.find(b=>b.role==='trash');if(!trash||emails.some(e=>!e.mailboxIds[trash.id]))throw new PublicError(409,'Kun mails i Papirkurv kan slettes permanent.');checkedSet(await jmap('Email/set',{accountId:row.engine_id,destroy:ids},mailboxAuth(row)),'notDestroyed');}
  else{
   let folderId:string|undefined,keyword:string|undefined,enabled=true;
   if(['archive','trash','spam','move'].includes(data.action)){folderId=data.action==='move'?data.folderId:boxes.find(b=>b.role===({archive:'archive',trash:'trash',spam:'junk'} as Record<string,string>)[data.action])?.id;if(!folderId||!boxes.some(b=>b.id===folderId&&b.role!=='drafts'))throw new PublicError(400,'Vælg en eksisterende mappe.');}
   if(['read','unread'].includes(data.action)){keyword='$seen';enabled=data.action==='read';}
   if(['star','unstar'].includes(data.action)){keyword='$flagged';enabled=data.action==='star';}
   if(['label','unlabel'].includes(data.action)){const id=uuid.parse(data.labelId);if(!(await db.query('SELECT 1 FROM mail_labels WHERE id=$1 AND mailbox_id=$2',[id,row.id])).rowCount)throw new PublicError(404,'Labelen findes ikke.');keyword='fm-label-'+id;enabled=data.action==='label';}
   const update:Record<string,Record<string,unknown>>={};for(const email of emails){const patch:Record<string,unknown>={};if(keyword)patch['keywords/'+keyword]=enabled?true:null;if(folderId){for(const id of Object.keys(email.mailboxIds))if(id!==folderId)patch['mailboxIds/'+id]=null;patch['mailboxIds/'+folderId]=true;}update[email.id]=patch;}
   checkedSet(await jmap('Email/set',{accountId:row.engine_id,update},mailboxAuth(row)),'notUpdated');
  }
  await audit(req.user!.id,'mail.'+data.action,row.id);res.json({ok:true});
 });
 router.get('/:id/threads/:threadId',async(req,res)=>{const row=await access(req);const thread=await jmap('Thread/get',{accountId:row.engine_id,ids:[mailId.parse(req.params.threadId)]},mailboxAuth(row));const item=(thread.list as {emailIds:string[]}[])[0];if(!item)throw new PublicError(404,'Samtalen findes ikke.');const result=await jmap('Email/get',{accountId:row.engine_id,ids:item.emailIds.slice(-100),properties:['id','subject','from','to','receivedAt','preview','keywords','hasAttachment','threadId']},mailboxAuth(row));res.json({items:result.list});});
 router.get('/:id/identity',async(req,res)=>{const row=await access(req);const data=(await db.query('SELECT signature_cipher FROM mail_identity_preferences WHERE mailbox_id=$1 AND user_id=$2',[row.id,req.user!.id])).rows[0];const aliases=(await db.query("SELECT a.local_part||'@'||d.name AS address FROM mail_aliases a JOIN domains d ON d.id=a.domain_id WHERE a.mailbox_id=$1 AND d.sending_status IN('verified','enabled')",[row.id])).rows;res.json({address:row.local_part+'@'+row.domain,senders:[row.local_part+'@'+row.domain,...aliases.map(a=>a.address)],signature:data?unseal(data.signature_cipher):''});});
 router.put('/:id/identity',async(req,res)=>{const row=await access(req,true);const {signature}=z.object({signature:z.string().max(5000)}).parse(req.body);await db.query('INSERT INTO mail_identity_preferences(mailbox_id,user_id,signature_cipher) VALUES($1,$2,$3) ON CONFLICT(mailbox_id,user_id) DO UPDATE SET signature_cipher=excluded.signature_cipher',[row.id,req.user!.id,seal(signature)]);res.json({ok:true});});
 router.get('/:id/events',async(req,res)=>{
  const row=await access(req),user=req.user!.id;if((streams.get(user)||0)>=3)throw new PublicError(429,'For mange åbne mailvinduer.');streams.set(user,(streams.get(user)||0)+1);
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();activeStreams.add(res);let closed=false,busy=false,previous='';
  const tick=async()=>{if(closed||busy)return;busy=true;try{await authenticate(req,res,()=>{});if(!(await db.query('SELECT 1 FROM mailbox_members WHERE mailbox_id=$1 AND user_id=$2',[row.id,user])).rowCount)throw Error('revoked');const values=await jmap('Email/get',{accountId:row.engine_id,ids:[],properties:['id']},mailboxAuth(row));const boxes=await folders(row),payload=JSON.stringify({state:values.state,folders:boxes});if(payload!==previous){res.write('event: mail\ndata: '+payload+'\n\n');previous=payload;}else res.write(': keepalive\n\n');}catch{res.write('event: expired\ndata: {}\n\n');res.end();}finally{busy=false;}};
  const timer=setInterval(()=>void tick(),5000);res.on('close',()=>{activeStreams.delete(res);closed=true;clearInterval(timer);streams.set(user,Math.max(0,(streams.get(user)||1)-1));});void tick();
 });
 return router;
}

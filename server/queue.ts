import {randomUUID} from 'node:crypto';
import {db} from './db.js';
import {seal,unseal} from './security.js';
import {processingReady,requireStorage} from './storage.js';
import {resend,downloadRaw,ProviderError} from './provider.js';
import {provision,importMail,jmap,mailboxAuth} from './engine.js';
import {scan} from './scanner.js';

export async function enqueue(kind:string,key:string,payload:unknown){await db.query('INSERT INTO jobs(kind,dedupe_key,payload) VALUES($1,$2,$3) ON CONFLICT(dedupe_key) DO NOTHING',[kind,key,JSON.stringify({cipher:seal(JSON.stringify(payload))})]);}
type Job={id:string;kind:string;payload:{cipher:string};attempts:number;lease_token:string;created_at:string};
async function receive(payload:{emailId:string}){
 const email=await resend('/emails/receiving/'+encodeURIComponent(payload.emailId));
 // Envelope recipients are trusted provider fields, never headers controlled by a sender.
 const recipients=[...new Set([...(email.to||[]),...(email.cc||[]),...(email.bcc||[]),...(email.received_for||[])].filter((v):v is string=>typeof v==='string').map(v=>v.toLowerCase()))];
 const rows=(await db.query('SELECT m.id FROM mailboxes m JOIN domains d ON d.id=m.domain_id WHERE lower(m.local_part||\'@\'||d.name)=ANY($1)',[recipients])).rows;
 if(!rows.length)return; // Catch-all is deliberately disabled; no unauthorized account is created.
 if(!email.raw?.download_url)throw new Error('provider_raw_unavailable');
 const raw=await downloadRaw(email.raw.download_url);await scan(raw);
 for(const value of rows){
  if((await db.query('SELECT 1 FROM mail_receipts WHERE mailbox_id=$1 AND provider_id=$2',[value.id,payload.emailId])).rowCount)continue;
  await requireStorage();const row=await provision(value.id);
  const messageId='<'+payload.emailId+'@resend.invalid>';
  const id=await importMail(row,raw,'inbox',messageId);
  await db.query('INSERT INTO mail_receipts(mailbox_id,provider_id,engine_message_id,authentication_cipher) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[row.id,payload.emailId,id,seal(JSON.stringify(email.authentication||{}))]);
 }
}
async function send(payload:{submissionId:string}){
 const item=(await db.query('SELECT * FROM mail_submissions WHERE id=$1',[payload.submissionId])).rows[0];if(!item)return;
 const data=JSON.parse(unseal(item.payload_cipher));const row=await provision(item.mailbox_id);
 if(!item.provider_id){
  // Resend idempotency retention is 24 hours. Never blindly resend an ambiguous older request.
  if(Date.now()-new Date(item.created_at).getTime()>23*3600000){await db.query("UPDATE mail_submissions SET state='uncertain',last_error_code='idempotency_expired' WHERE id=$1",[item.id]);throw new Error('idempotency_expired');}
  await requireStorage();const result=await resend('/emails','POST',data.provider,'fjordmail/'+item.id);
  if(!result.id)throw new Error('provider_missing_id');
  await db.query("UPDATE mail_submissions SET provider_id=$1,state='accepted' WHERE id=$2",[result.id,item.id]);item.provider_id=result.id;
 }
 if(!item.sent_id){await requireStorage();const raw=Buffer.from(data.raw,'base64');const id=await importMail(row,raw,'sent',data.messageId);await db.query('UPDATE mail_submissions SET sent_id=$1 WHERE id=$2',[id,item.id]);}
 if(item.draft_id)await jmap('Email/set',{accountId:row.engine_id,destroy:[item.draft_id]},mailboxAuth(row));
}
async function delivery(payload:{type:string;emailId:string}){
 const state=({'email.delivered':'delivered','email.bounced':'bounced','email.failed':'failed'} as Record<string,string>)[payload.type];if(!state)return;
 const result=await db.query("UPDATE mail_submissions SET state=$1 WHERE provider_id=$2 AND state NOT IN('bounced','failed')",[state,payload.emailId]);
 // A provider event can arrive before the send response has been committed.
 if(!result.rowCount)throw new Error('submission_not_registered');
}
let stopping=false;let pending:Promise<void>|undefined;let timer:NodeJS.Timeout|undefined;
async function pollReceiving(){
 const claimed=await db.query("UPDATE mail_poll_state SET checked_at=now() WHERE id=true AND (checked_at IS NULL OR checked_at<now()-interval '30 seconds') RETURNING since");if(!claimed.rowCount)return;
 const since=new Date(claimed.rows[0].since).getTime();let after:string|undefined;let newest=since;
 for(let page=0;page<50;page++){
  const result=await resend('/emails/receiving?limit=100'+(after?'&after='+encodeURIComponent(after):''));
  const list=result.data as {id:string;created_at:string}[];if(!Array.isArray(list))throw new Error('provider_list_invalid');let older=false;
  for(const item of list){const timestamp=new Date(item.created_at).getTime();if(!Number.isFinite(timestamp))throw new Error('provider_timestamp_invalid');if(timestamp<since){older=true;break;}
   await enqueue('receive','resend-email:'+item.id,{emailId:item.id});newest=Math.max(newest,timestamp);}
  if(older||!result.has_more||!list.length){await db.query('UPDATE mail_poll_state SET since=greatest(since,$1) WHERE id=true',[new Date(newest).toISOString()]);return;}
  after=list[list.length-1].id;
 }
 throw new Error('provider_poll_page_limit');
}
async function step(){
 if(stopping||!await processingReady())return;
 try{await pollReceiving();}catch{console.error('mail_poll_failed');}
 const token=randomUUID();const result=await db.query("WITH next AS (SELECT id FROM jobs WHERE (state='queued' AND available_at<=now()) OR (state='running' AND lease_until<now()) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE jobs j SET state='running',lease_until=now()+interval '5 minutes',lease_token=$1,attempts=attempts+1 FROM next WHERE j.id=next.id RETURNING j.*",[token]);
 const job=result.rows[0] as Job|undefined;if(!job)return;
 const heartbeat=setInterval(()=>db.query("UPDATE jobs SET lease_until=now()+interval '5 minutes' WHERE id=$1 AND lease_token=$2 AND state='running'",[job.id,token]).catch(()=>{}),30000);heartbeat.unref();
 try{const payload=JSON.parse(unseal(job.payload.cipher));if(job.kind==='receive')await receive(payload);else if(job.kind==='send')await send(payload);else if(job.kind==='delivery')await delivery(payload);else throw new Error('unknown_job');
  await db.query("UPDATE jobs SET state='done',lease_until=NULL,lease_token=NULL,last_error_code=NULL WHERE id=$1 AND lease_token=$2",[job.id,token]);
 }catch(error){const code=error instanceof ProviderError?'provider_'+error.status:error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'mail_processing_failed';const permanent=code==='malware_found'||code==='idempotency_expired'||error instanceof ProviderError&&[400,401,403,422].includes(error.status);const dead=permanent||job.attempts>=12;
  await db.query("UPDATE jobs SET state=$1,available_at=now()+($2*interval '1 second'),lease_until=NULL,lease_token=NULL,last_error_code=$3 WHERE id=$4 AND lease_token=$5",[dead?'dead':'queued',Math.min(3600,10*2**job.attempts),code,job.id,token]);
  if(job.kind==='send'&&dead){const payload=JSON.parse(unseal(job.payload.cipher));await db.query("UPDATE mail_submissions SET state=CASE WHEN state='queued' THEN 'failed' ELSE state END,last_error_code=$1 WHERE id=$2",[code,payload.submissionId]);}
  console.error('mail_job_failed',{id:job.id,code});
 }finally{clearInterval(heartbeat);}
}
export function startWorker(){stopping=false;timer=setInterval(()=>{if(!pending)pending=step().catch(()=>console.error('mail_worker_unavailable')).finally(()=>{pending=undefined;});},1000);timer.unref();}
export async function stopWorker(){stopping=true;if(timer)clearInterval(timer);await pending;}

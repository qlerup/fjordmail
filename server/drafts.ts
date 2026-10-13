import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {db} from './db.js';
import {PublicError,seal,unseal} from './security.js';
import {message,importMail,type EngineRow} from './engine.js';
import {messageHtml} from './html.js';
import {bodyText,descriptor,buildComposition,compositionFingerprint,type Composition,type Part} from './composition.js';

export type Draft={id:string;mailbox_id:string;owner_id:string;engine_message_id:string|null;revision:number;fingerprint:string|null;composition_cipher:string|null;state:string};
export function ownDraft(draft:Draft|undefined,row:EngineRow,user:string):asserts draft is Draft{
 if(!draft||draft.mailbox_id!==row.id||draft.owner_id!==user)throw new PublicError(404,'Kladden findes ikke.');
 if(draft.state!=='editing')throw new PublicError(409,'Kladden er allerede sendt eller sat i kÃ¸.');
}
export async function draftContent(row:EngineRow,user:string,draft:Draft){
 if(!draft.engine_message_id)throw new PublicError(409,'Kladden er endnu ikke gemt.');
 const value=await message(row,draft.engine_message_id);
 const meta=draft.composition_cipher?JSON.parse(unseal(draft.composition_cipher)):{context:null,attachmentIds:[]};
 const addresses=(key:string)=>(value[key] as {email:string}[]||[]).map(v=>v.email);
 const attachments=(value.attachments as Part[]||[]).map((p,i)=>descriptor(row,user,p,meta.attachmentIds[i]||randomUUID()));
 return {id:draft.id,from:(value.from as {email:string}[]||[])[0]?.email,replyTo:(value.replyTo as {email:string}[]||[])[0]?.email,revision:draft.revision,to:addresses('to'),cc:addresses('cc'),bcc:addresses('bcc'),subject:String(value.subject||''),text:bodyText(value),html:messageHtml(value)||null,context:meta.context,attachments};
}
export async function cleanup(client:PoolClient,row:EngineRow,ids:string[],key:string){
 if(!ids.length)return;
 await client.query("INSERT INTO jobs(kind,dedupe_key,payload) VALUES('draft_cleanup',$1,$2) ON CONFLICT(dedupe_key) DO NOTHING",[key,JSON.stringify({cipher:seal(JSON.stringify({mailboxId:row.id,ids}))})]);
}
export async function saveDraft(row:EngineRow,user:string,id:string,revision:number,data:Composition){
 const client=await db.connect();
 try{await client.query('BEGIN');
  await client.query('INSERT INTO mail_drafts(id,mailbox_id,owner_id) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[id,row.id,user]);
  const draft=(await client.query('SELECT * FROM mail_drafts WHERE id=$1 FOR UPDATE',[id])).rows[0] as Draft;
  ownDraft(draft,row,user);const fingerprint=compositionFingerprint(data);
  if(revision===draft.revision&&fingerprint===draft.fingerprint){await client.query('COMMIT');return {id,revision};}
  if(revision!==draft.revision+1)throw new PublicError(409,'Kladden er Ã¦ndret i en anden fane. Ã…bn den igen.');
  const built=await buildComposition(row,user,data,'<draft-'+id+'@'+row.domain+'>');
  const engineId=await importMail(row,built.raw,'drafts','draft:'+id+':'+revision+':'+fingerprint);
  await client.query('UPDATE mail_drafts SET engine_message_id=$1,revision=$2,fingerprint=$3,composition_cipher=$4,updated_at=now() WHERE id=$5',[engineId,revision,fingerprint,seal(JSON.stringify({context:data.context,attachmentIds:data.attachments.map(a=>a.id)})),id]);
  if(draft.engine_message_id)await cleanup(client,row,[draft.engine_message_id],'draft-old:'+id+':'+revision);
  await client.query('COMMIT');return {id,revision};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function discardDraft(row:EngineRow,user:string,id:string){
 const client=await db.connect();try{await client.query('BEGIN');const draft=(await client.query('SELECT * FROM mail_drafts WHERE id=$1 FOR UPDATE',[id])).rows[0] as Draft|undefined;
  if(draft?.state==='discarded'&&draft.owner_id===user&&draft.mailbox_id===row.id){await client.query('COMMIT');return;}
  ownDraft(draft,row,user);await client.query("UPDATE mail_drafts SET state='discarded',updated_at=now() WHERE id=$1",[id]);
  if(draft.engine_message_id)await cleanup(client,row,[draft.engine_message_id],'draft-discard:'+id);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

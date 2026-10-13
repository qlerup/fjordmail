import {createHmac,randomUUID} from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import {db} from './db.js';
import {env} from './config.js';
import {seal,unseal} from './security.js';
import {message,blob,provision} from './engine.js';
import {scan} from './scanner.js';
export async function forwardMail(payload:{mailboxId:string;messageId:string;providerId:string}){
 const setting=(await db.query("SELECT f.*,d.sending_status FROM mail_forwarding f JOIN mailbox_members m ON m.mailbox_id=f.mailbox_id AND m.user_id=f.actor_id AND m.permission='write' JOIN mailboxes b ON b.id=f.mailbox_id JOIN domains d ON d.id=b.domain_id WHERE f.mailbox_id=$1 AND f.enabled",[payload.mailboxId])).rows[0];if(!setting||!['verified','enabled'].includes(setting.sending_status))return;
 const row=await provision(payload.mailboxId),value=await message(row,payload.messageId);const headers=value.headers as {name:string;value:string}[];
 // RFC 3834 loop prevention; automated mail is not forwarded repeatedly.
 if(headers?.some(h=>h.name.toLowerCase()==='auto-submitted'&&h.value.trim().toLowerCase()!=='no'))return;
 const raw=await blob(row,String(value.blobId));if(raw.length>15000000)throw Error('forward_attachment_too_large');await scan(raw);
 const recipient=unseal(setting.recipient_cipher),from=row.local_part+'@'+row.domain,id=randomUUID(),messageId='<'+id+'@'+row.domain+'>';
 const subject=('Fwd: '+String(value.subject||'')).slice(0,998).replace(/[\r\n]/g,' ');const text='Automatisk videresendt fra '+from+'. Den originale mail er vedhæftet.';
 const output=await new MailComposer({from,to:recipient,subject,text,messageId,headers:{'Auto-Submitted':'auto-generated'},attachments:[{filename:'original.eml',content:raw,contentType:'message/rfc822'}],disableFileAccess:true,disableUrlAccess:true}).compile().build();
 const provider={from,to:[recipient],subject,text,headers:{'Message-ID':messageId,'Auto-Submitted':'auto-generated'},attachments:[{filename:'original.eml',content:raw.toString('base64'),content_type:'message/rfc822'}]};
 const hex=createHmac('sha256',env.APP_ENCRYPTION_KEY).update('forward:'+payload.mailboxId+':'+payload.providerId).digest('hex').slice(0,32);const key=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
 const client=await db.connect();try{await client.query('BEGIN');const inserted=await client.query("INSERT INTO mail_submissions(id,mailbox_id,actor_id,request_key,draft_id,payload_cipher,source_key) VALUES($1,$2,$3,$4,'',$5,$6) ON CONFLICT(source_key) DO NOTHING RETURNING id",[id,row.id,setting.actor_id,key,seal(JSON.stringify({provider,raw:output.toString('base64'),messageId})),'forward:'+payload.mailboxId+':'+payload.providerId]);
  if(inserted.rowCount)await client.query("INSERT INTO jobs(kind,dedupe_key,payload) VALUES('send',$1,$2)",['send:'+id,JSON.stringify({cipher:seal(JSON.stringify({submissionId:id}))})]);await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

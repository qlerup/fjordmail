import {createHmac,randomUUID} from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import sanitizeHtml from 'sanitize-html';
import {z} from 'zod';
import {env} from './config.js';
import {PublicError,seal,unseal} from './security.js';
import {blob,message,type EngineRow} from './engine.js';
import {scan} from './scanner.js';

export const mailId=z.string().min(1).max(200).regex(/^[A-Za-z0-9_.-]+$/);
const email=z.string().email().max(254);
export const context=z.object({mode:z.enum(['reply','replyAll','forward']),messageId:mailId});
export const composition=z.object({
 to:z.array(email).max(20).default([]),cc:z.array(email).max(20).default([]),bcc:z.array(email).max(20).default([]),
 subject:z.string().max(998).refine(v=>!/[\r\n]/.test(v)),text:z.string().max(40000),
 attachments:z.array(z.object({id:z.string().uuid(),token:z.string().max(6000)})).max(10).default([]),
 context:context.nullable().default(null)
});
export type Composition=z.infer<typeof composition>;
export type FileDescriptor={id:string;name:string;type:string;size:number;token:string;partId?:string};
export type Part={partId:string;blobId:string;name:string|null;type:string;size:number};
const capability=z.object({mailboxId:z.string().uuid(),userId:z.string().uuid(),blobId:z.string().min(1).max(300),name:z.string().max(255),type:z.string().max(127),size:z.number().int().min(0).max(10000000),expiresAt:z.number()});
export function fileName(name:string){const clean=name.replace(/[\r\n\x00-\x1f\x7f\\/]/g,'_').slice(0,255);return clean||'vedhaeftning';}
export function descriptor(row:EngineRow,userId:string,part:Part,id=randomUUID()):FileDescriptor{
 const name=fileName(part.name||'vedhaeftning');const token=seal(JSON.stringify({mailboxId:row.id,userId,blobId:part.blobId,name,type:part.type||'application/octet-stream',size:part.size,expiresAt:Date.now()+23*3600000}));
 return {id,name,type:part.type,size:part.size,token,partId:part.partId};
}
export async function resolveFiles(row:EngineRow,userId:string,files:Composition['attachments']){
 let total=0;const output:{filename:string;contentType:string;content:Buffer}[]=[];
 for(const file of files){let data:z.infer<typeof capability>;
  try{data=capability.parse(JSON.parse(unseal(file.token)));}catch{throw new PublicError(400,'VedhÃ¦ftningen kunne ikke godkendes.');}
  if(data.mailboxId!==row.id||data.userId!==userId)throw new PublicError(403,'VedhÃ¦ftningen tilhÃ¸rer en anden konto.');
  if(data.expiresAt<Date.now())throw new PublicError(409,'VedhÃ¦ftningens adgang er udlÃ¸bet. Ã…bn kladden igen.');
  const content=await blob(row,data.blobId);if(content.length!==data.size)throw new PublicError(409,'VedhÃ¦ftningen har Ã¦ndret stÃ¸rrelse.');total+=content.length;
  if(total>15000000)throw new PublicError(413,'VedhÃ¦ftninger mÃ¥ samlet hÃ¸jst fylde 15 MB.');
  await scan(content);output.push({filename:fileName(data.name),contentType:data.type,content});
 }
 return output;
}
export function bodyText(value:Record<string,unknown>){
 const bodies=value.bodyValues as Record<string,{value:string}>,textParts=value.textBody as {partId:string}[],htmlParts=value.htmlBody as {partId:string}[];
 return (textParts||[]).map(p=>bodies?.[p.partId]?.value||'').join('\n')||sanitizeHtml((htmlParts||[]).map(p=>bodies?.[p.partId]?.value||'').join('\n'),{allowedTags:[],allowedAttributes:{}});
}
export function cleanMessageId(value:unknown){if(typeof value!=='string')return null;const id=value.replace(/^<|>$/g,'');return /^[^\s<>\r\n]{1,998}@[^\s<>\r\n]{1,253}$/.test(id)?'<'+id+'>':null;}
export async function buildComposition(row:EngineRow,userId:string,data:Composition,messageId:string){
 const files=await resolveFiles(row,userId,data.attachments);let inReplyTo:string|undefined,references:string[]|undefined;
 if(data.context&&data.context.mode!=='forward'){
  const source=await message(row,data.context.messageId);
  inReplyTo=cleanMessageId((source.messageId as unknown[]|undefined)?.[0])||undefined;
  references=[...new Set([...(source.references as unknown[]||[]),...(source.messageId as unknown[]||[])].map(cleanMessageId).filter((v):v is string=>!!v))].slice(-20);
 }
 const from=row.local_part+'@'+row.domain;
 const mime=new MailComposer({from,to:data.to,cc:data.cc,bcc:data.bcc,subject:data.subject,text:data.text,messageId,inReplyTo,references,date:new Date(),attachments:files,disableFileAccess:true,disableUrlAccess:true}).compile();mime.keepBcc=true;const raw=await mime.build();
 if(raw.length>25000000)throw new PublicError(413,'Den samlede mail er for stor.');
 const headers:Record<string,string>={'Message-ID':messageId};if(inReplyTo)headers['In-Reply-To']=inReplyTo;if(references?.length)headers.References=references.join(' ');
 return {raw,provider:{from,to:data.to,cc:data.cc,bcc:data.bcc,subject:data.subject,text:data.text,headers,attachments:files.map(f=>({filename:f.filename,content:f.content.toString('base64'),content_type:f.contentType}))}};
}
export function compositionFingerprint(data:Composition){return createHmac('sha256',env.APP_ENCRYPTION_KEY).update(JSON.stringify(data)).digest('hex');}

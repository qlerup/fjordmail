import {createHmac} from 'node:crypto';
import {env} from './config.js';
import {db} from './db.js';
import {PublicError,seal,unseal} from './security.js';

export type EngineRow={id:string;local_part:string;domain:string;engine_id:string;engine_secret_cipher:string};
type ObjectValue=Record<string,unknown>;
const core='urn:ietf:params:jmap:core',mail='urn:ietf:params:jmap:mail',management='urn:stalwart:jmap';
function auth(name:string,secret:string){return 'Basic '+Buffer.from(name+':'+secret).toString('base64');}
export async function engineFetch(path:string,authorization:string,init:RequestInit={}){
 if(path==='/.well-known/jmap')path='/jmap/session';
 const response=await fetch(new URL(path,env.STALWART_URL),{...init,headers:{...init.headers,Authorization:authorization},signal:AbortSignal.timeout(20000),redirect:'error'});
 if(!response.ok)throw new PublicError(503,'Mailmotoren kunne ikke gennemføre handlingen.');return response;
}
export async function jmap(name:string,args:ObjectValue,authorization:string,admin=false):Promise<ObjectValue>{
 const response=await engineFetch('/jmap',authorization,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({using:[core,admin?management:mail],methodCalls:[[name,args,'call']]})});
 const result=await response.json();const call=result.methodResponses?.[0];
 if(!call||call[0]!==name||call[1]?.type)throw new PublicError(503,'Mailmotorens svar kunne ikke behandles.');return call[1];
}
export function adminAuth(){if(!env.STALWART_ADMIN_PASSWORD)throw new PublicError(503,'Mailmotorens installationsnøgle mangler.');return auth('admin@gleruphub.dk',env.STALWART_ADMIN_PASSWORD);}
export function mailboxAuth(row:EngineRow){return auth(row.local_part+'@'+row.domain,unseal(row.engine_secret_cipher));}
function created(result:ObjectValue,key:string){const value=(result.created as Record<string,{id:string}>|undefined)?.[key];if(!value?.id)throw new PublicError(503,'Mailmotoren kunne ikke oprette kontoen.');return value.id;}
export async function provision(id:string){
 const client=await db.connect();
 try{
  await client.query('BEGIN');const row=(await client.query('SELECT m.*,d.name AS domain,d.engine_id AS domain_engine_id FROM mailboxes m JOIN domains d ON d.id=m.domain_id WHERE m.id=$1 FOR UPDATE OF m,d',[id])).rows[0];
  if(!row)throw new PublicError(404,'Mailkontoen findes ikke.');
  const authorization=adminAuth();let domainId=row.domain_engine_id;
  if(!domainId){const values=(await jmap('x:Domain/get',{},authorization,true)).list as {id:string;name:string}[];domainId=values.find(v=>v.name===row.domain)?.id;
   if(!domainId)domainId=created(await jmap('x:Domain/set',{create:{domain:{name:row.domain,certificateManagement:{'@type':'Manual'},dkimManagement:{'@type':'Manual'},dnsManagement:{'@type':'Manual'},allowRelaying:false}}},authorization,true),'domain');
   await client.query('UPDATE domains SET engine_id=$1 WHERE id=$2',[domainId,row.domain_id]);}
  // Stable installation-bound secret permits recovery after an engine create followed by a DB crash.
  const secret=row.engine_secret_cipher?unseal(row.engine_secret_cipher):createHmac('sha256',env.APP_ENCRYPTION_KEY).update('mailbox-service:'+id).digest('base64url');
  let engineId=row.engine_id;
  if(!engineId){const result=await jmap('x:Account/query',{filter:{name:row.local_part,domainId}},authorization,true);const ids=result.ids as string[];
   if(ids.length){const existing=(await jmap('x:Account/get',{ids},authorization,true)).list as {id:string;name:string;domainId:string}[];engineId=existing.find(v=>v.name===row.local_part&&v.domainId===domainId)?.id;}
   if(engineId){await engineFetch('/.well-known/jmap',auth(row.local_part+'@'+row.domain,secret));}
   else engineId=created(await jmap('x:Account/set',{create:{account:{'@type':'User',name:row.local_part,domainId,credentials:{'0':{'@type':'Password',secret}},roles:{'@type':'User'},permissions:{'@type':'Inherit'},quotas:{},aliases:{},memberGroupIds:{},encryptionAtRest:{'@type':'Disabled'},description:row.display_name}}},authorization,true),'account');
  }
  await client.query("UPDATE mailboxes SET engine_id=$1,engine_secret_cipher=$2,provision_status='ready' WHERE id=$3",[engineId,seal(secret),id]);await client.query('COMMIT');
  return {...row,engine_id:engineId,engine_secret_cipher:seal(secret)} as EngineRow;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function folders(row:EngineRow){const result=await jmap('Mailbox/get',{accountId:row.engine_id},mailboxAuth(row));const list=result.list as {id:string;name:string;role:string|null;totalEmails:number;unreadEmails:number}[];
 const required=[['drafts','Kladder'],['sent','Sendt'],['archive','Arkiv'],['junk','Spam'],['trash','Papirkurv']];
 for(const [role,name] of required)if(!list.some(f=>f.role===role)){const made=await jmap('Mailbox/set',{accountId:row.engine_id,create:{folder:{name,role}}},mailboxAuth(row));created(made,'folder');}
 return (await jmap('Mailbox/get',{accountId:row.engine_id},mailboxAuth(row))).list as typeof list;
}
export async function upload(row:EngineRow,raw:Buffer){return await (await engineFetch('/jmap/upload/'+encodeURIComponent(row.engine_id),mailboxAuth(row),{method:'POST',headers:{'Content-Type':'message/rfc822'},body:new Uint8Array(raw)})).json() as {blobId:string};}
export async function findMessage(row:EngineRow,messageId:string){const result=await jmap('Email/query',{accountId:row.engine_id,filter:{hasKeyword:'fm-import-'+messageId},limit:1},mailboxAuth(row));return (result.ids as string[])[0];}
export async function importMail(row:EngineRow,raw:Buffer,role:string,messageId:string){
 const token=createHmac('sha256',env.APP_ENCRYPTION_KEY).update('import:'+row.id+':'+messageId).digest('hex');
 const existing=await findMessage(row,token);if(existing)return existing;
 const box=(await folders(row)).find(f=>f.role===role);if(!box)throw new PublicError(503,'Mailmappen kunne ikke findes.');
 const marked=Buffer.concat([Buffer.from('X-FjordMail-Import: '+token+'\r\n'),raw]);
 const keywords:Record<string,boolean>={['fm-import-'+token]:true};if(role==='drafts')keywords['$draft']=true;if(role==='sent')keywords['$seen']=true;
 const blob=await upload(row,marked);const result=await jmap('Email/import',{accountId:row.engine_id,emails:{email:{blobId:blob.blobId,mailboxIds:{[box.id]:true},keywords}}},mailboxAuth(row));return created(result,'email');
}
export async function message(row:EngineRow,id:string){const result=await jmap('Email/get',{accountId:row.engine_id,ids:[id],fetchAllBodyValues:true,maxBodyValueBytes:2000000},mailboxAuth(row));const value=(result.list as ObjectValue[])[0];if(!value)throw new PublicError(404,'Mailen findes ikke.');return value;}
export async function blob(row:EngineRow,blobId:string){const response=await engineFetch('/jmap/download/'+encodeURIComponent(row.engine_id)+'/'+encodeURIComponent(blobId)+'/attachment',mailboxAuth(row));const length=Number(response.headers.get('content-length')||0);if(length>25000000)throw new PublicError(413,'Filen er for stor.');const chunks:Uint8Array[]=[];let size=0;for await(const part of response.body!){size+=part.length;if(size>25000000)throw new PublicError(413,'Filen er for stor.');chunks.push(part);}return Buffer.concat(chunks);}

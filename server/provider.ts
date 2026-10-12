import {Webhook} from 'svix';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import https from 'node:https';
import {env} from './config.js';
import {db} from './db.js';
import {PublicError,unseal} from './security.js';

export async function providerConfig(){const row=(await db.query("SELECT * FROM provider_settings WHERE id='resend'")).rows[0];return {key:env.RESEND_API_KEY||(row?.api_key_cipher?unseal(row.api_key_cipher):''),secret:env.RESEND_WEBHOOK_SECRET||(row?.webhook_secret_cipher?unseal(row.webhook_secret_cipher):''),checkedAt:row?.checked_at};}
export async function resend(path:string,method='GET',body?:unknown,idempotency?:string){
 const {key}=await providerConfig();if(!key)throw new PublicError(503,'Resend API-nøglen mangler.');
 const response=await fetch('https://api.resend.com'+path,{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',...(idempotency?{'Idempotency-Key':idempotency}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000),redirect:'error'});
 if(!response.ok)throw new ProviderError(response.status);return await response.json();
}
export class ProviderError extends Error{constructor(public status:number){super('provider_'+status);}}
export function verifyEvent(raw:Buffer,headers:Record<string,string>,secret:string){const payload=raw.toString('utf8');new Webhook(secret).verify(payload,headers);return JSON.parse(payload) as unknown;}
export function publicIPv4(ip:string){if(isIP(ip)!==4)return false;const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19));}
// Only explicit provider CDN hostnames, public IPv4 pinned after resolution, no redirects.
export async function downloadRaw(address:string){
 const url=new URL(address);const allowed=env.RESEND_DOWNLOAD_HOSTS.split(',').map(s=>s.trim().toLowerCase());
 if(url.protocol!=='https:'||url.port&&url.port!=='443'||url.username||url.password||!allowed.includes(url.hostname.toLowerCase()))throw new PublicError(502,'Resend-downloadadressen er ikke godkendt.');
 const answers=await lookup(url.hostname,{all:true,family:4});if(!answers.length||answers.some(a=>!publicIPv4(a.address)))throw new PublicError(502,'Resend-downloadadressen er ikke offentlig.');const addressIP=answers[0].address;
 return await new Promise<Buffer>((resolve,reject)=>{
  const request=https.get(url,{family:4,lookup:(_hostname,_options,callback)=>callback(null,addressIP,4),timeout:20000},response=>{
   if(response.statusCode!==200){response.destroy();reject(new Error('download_status'));return;}
   const chunks:Buffer[]=[];let size=0;response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>25000000){response.destroy(new Error('download_size'));return;}chunks.push(chunk);});response.on('end',()=>resolve(Buffer.concat(chunks)));response.on('error',reject);
  });request.on('timeout',()=>request.destroy(new Error('download_timeout')));request.on('error',reject);
 });
}

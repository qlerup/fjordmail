import {env} from './config.js';
import {PublicError} from './security.js';
import {z} from 'zod';
export const hubIdentity=z.object({id:z.number().int().positive(),username:z.string().min(1).max(128),role:z.enum(['admin','user']),email:z.string().optional(),email_required:z.boolean().optional(),must_change_password:z.boolean().optional(),email_error:z.string().optional()});
export async function hubCall(path:string,payload:Record<string,unknown>={},method='POST'){
 const url=new URL(path,env.FJORDHUB_URL);const data={...payload,app_id:'fjordmail'};
 if(method==='GET')for(const [key,value]of Object.entries(data))url.searchParams.set(key,String(value));
 let response;
 try{response=await fetch(url,{method,headers:{'X-Hub-Key':env.FJORDHUB_API_KEY!,'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(data),signal:AbortSignal.timeout(6000),redirect:'error'});}
 catch{throw new PublicError(503,'FjordHub kan ikke kontaktes. Prøv igen.');}
 if(response.status===401||response.status===403)throw new PublicError(401,'Login eller appadgang kunne ikke godkendes.');
 if(!response.ok)throw new PublicError(503,'FjordHub kunne ikke gennemføre forespørgslen.');
 const result=await response.json();if(!result||result.ok!==true)throw new PublicError(401,'Login eller appadgang kunne ikke godkendes.');return result;
}

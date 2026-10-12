import {readFile,writeFile} from 'node:fs/promises';
import {env} from './config.js';
import {jmap,engineFetch,adminAuth} from './engine.js';
import {seal,unseal} from './security.js';
const authorization=(name:string,password:string)=>'Basic '+Buffer.from(name+':'+password).toString('base64');
if(!env.STALWART_ADMIN_PASSWORD)throw Error('STALWART_ADMIN_PASSWORD required');
let initial:string|undefined;
try{initial=unseal(await readFile(env.MAIL_STORAGE_ROOT+'/bootstrap-secret','utf8'));}catch{/* Fresh installation. */}
let access=authorization('admin',env.STALWART_ADMIN_PASSWORD);
try{
 const response=await jmap('x:Bootstrap/get',{},access,true);const value=(response.list as Record<string,unknown>[])[0];
 delete value.id;value.serverHostname='mail.gleruphub.dk';value.defaultDomain='gleruphub.dk';value.requestTlsCertificate=false;value.generateDkimKeys=false;(value.tracer as Record<string,unknown>).enable=false;
 const result=await jmap('x:Bootstrap/set',{update:{singleton:value}},access,true);
 const admin=(result.updated as Record<string,{username:string;secret:string}>)?.singleton;if(!admin?.username)throw Error('engine_bootstrap_failed');
 access=authorization(admin.username,admin.secret);await writeFile(env.MAIL_STORAGE_ROOT+'/bootstrap-secret',seal(access),{mode:0o600});
 console.log('Engine bootstrap saved. Restart engine and run setup-engine again to finish.');
 process.exit(0);
}catch(error){
 // A configured engine does not expose Bootstrap/get. Only continue when a known credential works.
 try{access=initial||adminAuth();await engineFetch('/.well-known/jmap',access);}catch{await engineFetch('/.well-known/jmap',adminAuth());access=adminAuth();}
 if(error instanceof Error&&error.message==='engine_bootstrap_failed')throw error;
}
const accounts=(await jmap('x:Account/get',{},access,true)).list as {id:string;emailAddress:string}[];
const administrator=accounts.find(a=>a.emailAddress==='admin@gleruphub.dk');if(!administrator)throw Error('engine_admin_missing');
const changed=await jmap('x:Account/set',{update:{[administrator.id]:{credentials:{'0':{'@type':'Password',secret:env.STALWART_ADMIN_PASSWORD}}}}},access,true);
if(!changed.updated||!(administrator.id in (changed.updated as Record<string,unknown>)))throw Error('engine_admin_update_failed');
access=adminAuth();await engineFetch('/.well-known/jmap',access);await writeFile(env.MAIL_STORAGE_ROOT+'/bootstrap-secret',seal(access),{mode:0o600});
const listeners=(await jmap('x:NetworkListener/get',{},access,true)).list as {id:string;protocol:string}[];
const disabled=listeners.filter(v=>v.protocol!=='http').map(v=>v.id);
if(disabled.length)await jmap('x:NetworkListener/set',{destroy:disabled},access,true);
console.log('Mail engine configured; mail protocol listeners disabled. Restart engine before enabling mail.');

import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL='postgresql://fixture:fixture@localhost/fixture';
process.env.APP_ENCRYPTION_KEY='test-only-key-012345678901234567890123456789';
process.env.FJORDHUB_URL='https://hub.test';
process.env.FJORDHUB_API_KEY='synthetic-app-key';
const {db}=await import('../server/db.js');
const {createApp}=await import('../server/app.js');

test('pending email blocks a valid existing session until a scoped CSRF-protected update',async t=>{
 const member={id:77,username:'Alice',role:'user',email:'old@example.test',email_required:true};
 const user={id:'00000000-0000-4000-8000-000000000001',hub_id:77,username:'Alice',email:'old@example.test',role:'user',preferences:{},csrf:'synthetic-csrf'};
 const dbCalls:string[]=[];
 t.mock.method(db,'query',async(sql:string)=>{dbCalls.push(sql);return {rows:[user],rowCount:1};});
 const nativeFetch=globalThis.fetch;
 const writes:{path:string;body:Record<string,unknown>}[]=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,options?:RequestInit)=>{
  const url=new URL(String(input));
  if(url.hostname!=='hub.test')return nativeFetch(input,options);
  assert.equal(new Headers(options?.headers).get('X-Hub-Key'),'synthetic-app-key');
  if(url.pathname.endsWith('/users'))return Response.json({ok:true,items:[member]});
  const body=JSON.parse(String(options?.body));writes.push({path:url.pathname,body});
  if(body.email==='duplicate@example.test')return Response.json({ok:true,accepted:false,error:'Already in use'});
  member.email_required=false;member.email=body.email;
  return Response.json({ok:true,accepted:true,user:member});
 });
 const server=createApp().listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
 const address=server.address();assert(address&&typeof address!=='string');
 const base=`http://127.0.0.1:${address.port}`;
 async function call(path:string,email?:string,csrf='synthetic-csrf',origin=base){return nativeFetch(base+path,{method:email===undefined?'GET':'POST',headers:{Cookie:'fjordmail_session=synthetic-token',Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf},body:email===undefined?undefined:JSON.stringify({email,id:999})});}
 const pending=await call('/api/auth/access');assert.equal(pending.status,403);
 assert.deepEqual(await pending.json(),{ok:false,authenticated:true,email_required:true,error_code:'email_update_required',csrf_token:'synthetic-csrf',error:'Bekræft eller opdater din email for at fortsætte.'});
 assert.equal((await call('/api/me')).status,403);
 assert.equal((await call('/api/auth/email','new@example.test','bad')).status,403);
 assert.equal((await call('/api/auth/email','new@example.test','synthetic-csrf','https://evil.test')).status,403);
 const invalid=await call('/api/auth/email','duplicate@example.test');assert.equal((await invalid.json()).accepted,false);
 assert.equal((await call('/api/me')).status,403);
 const saved=await call('/api/auth/email','new@example.test');assert.equal(saved.status,200);assert.equal((await saved.json()).accepted,true);
 assert.deepEqual(writes.at(-1),{path:'/api/hub/apps/users/77/email',body:{email:'new@example.test',app_id:'fjordmail'}});
 assert.equal((await call('/api/auth/access')).status,200);
 assert.equal((await call('/api/me')).status,200);
 assert(!dbCalls.some(sql=>sql.startsWith('DELETE FROM sessions')));
});

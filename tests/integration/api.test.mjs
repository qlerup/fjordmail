import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(process.cwd()+'/package.json');
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const base=process.env.TEST_BASE_URL||'http://app:8101';
const origin=new URL(base).origin;
let admin,userA,userB,mailbox;
async function call(path,{session,method='GET',body,headers={}}={}){
 const r=await fetch(base+'/api'+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
async function login(username,password,extra={}){
 const auth=await call('/auth/login',{method:'POST',body:{username,password,...extra}});assert.equal(auth.status,200);
 const s={cookie:auth.cookie};assert(s.cookie);const me=await call('/me',{session:s});assert.equal(me.status,200);return {...s,csrf:me.data.csrf,id:me.data.user.id};
}
test('Phase 1 actual PostgreSQL/API integration',{timeout:30000},async t=>{
 await t.test('healthy migration and anonymous/private endpoint boundaries',async()=>{
  assert.equal((await call('/health')).status,200);
  assert.equal((await call('/mailboxes')).status,401);
  assert.equal((await call('/webhooks/resend',{method:'POST',body:{type:'email.received'}})).status,503);
  admin=await login('admin',process.env.FIRST_ADMIN_PASSWORD);
 });
 await t.test('cross-origin and missing CSRF writes are rejected',async()=>{
  assert.equal((await call('/admin/domains',{session:admin,method:'POST',body:{name:'fixture.example'},headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await call('/admin/domains',{session:{cookie:admin.cookie},method:'POST',body:{name:'fixture.example'}})).status,403);
 });
 await t.test('local users complete email/password onboarding',async()=>{
  for(const username of ['alice','bob']){
   assert.equal((await call('/admin/users',{session:admin,method:'POST',body:{username,password:'Temporary-fixture-123!'}})).status,201);
   const first=await call('/auth/login',{method:'POST',body:{username,password:'Temporary-fixture-123!'}});
   assert.equal(first.data.onboardingRequired,true);assert.equal(first.cookie,undefined);
  }
  userA=await login('alice','Temporary-fixture-123!',{first_login_email:'alice@fixture.example',first_login_password:'Personal-fixture-A123!',first_login_password_confirm:'Personal-fixture-A123!'});
  userB=await login('bob','Temporary-fixture-123!',{first_login_email:'bob@fixture.example',first_login_password:'Personal-fixture-B123!',first_login_password_confirm:'Personal-fixture-B123!'});
 });
 await t.test('private mailbox isolation includes administrators',async()=>{
  const domain=await call('/admin/domains',{session:admin,method:'POST',body:{name:'fixture.example'}});assert.equal(domain.status,201);
  const m=await call('/admin/mailboxes',{session:admin,method:'POST',body:{domainId:domain.data.id,localPart:'alice',displayName:'Alice private',kind:'personal',userIds:[userA.id]}});assert.equal(m.status,201);mailbox=m.data.id;
  assert.equal((await call('/mailboxes',{session:userA})).data.items.length,1);
  assert.equal((await call('/mailboxes',{session:userB})).data.items.length,0);
  assert.equal((await call('/mailboxes',{session:admin})).data.items.length,0);
  assert.equal((await call('/mailboxes/'+mailbox+'/messages',{session:userB})).status,404);
  assert.equal((await call('/mailboxes/'+mailbox+'/messages',{session:admin})).status,404);
  assert.equal((await call('/mailboxes/'+mailbox+'/messages',{session:userA})).status,503);
  assert.equal((await call('/admin/mailboxes',{session:userB})).status,403);
 });
 await t.test('shared mailbox assignments and revocation are real',async()=>{
  const domains=(await call('/admin/domains',{session:admin})).data.items;
  const m=await call('/admin/mailboxes',{session:admin,method:'POST',body:{domainId:domains[0].id,localPart:'team',displayName:'Shared fixture',kind:'shared',userIds:[userA.id,userB.id]}});assert.equal(m.status,201);
  assert.equal((await call('/mailboxes',{session:userB})).data.items.length,1);
  assert.equal((await call('/admin/mailboxes/'+m.data.id+'/members',{session:admin,method:'PUT',body:{members:[{userId:userA.id,permission:'write'}]}})).status,200);
  assert.equal((await call('/mailboxes',{session:userB})).data.items.length,0);
 });
 await t.test('credentials encrypted at rest and never returned by config or audit',async()=>{
  const key='re_fixture_not_a_live_key_123';const secret='whsec_fixture_not_a_live_secret_123';
  assert.equal((await call('/admin/provider',{session:admin,method:'PUT',body:{apiKey:key,webhookSecret:secret}})).status,200);
  const config=await call('/admin/provider',{session:admin});assert(config.data.hasApiKey&&config.data.hasWebhookSecret);assert(!JSON.stringify(config).includes(key));
  const row=(await pool.query("SELECT api_key_cipher,webhook_secret_cipher FROM provider_settings WHERE id='resend'")).rows[0];assert(!row.api_key_cipher.includes(key));assert(!row.webhook_secret_cipher.includes(secret));
  assert(!JSON.stringify((await call('/admin/audit',{session:admin})).data).includes(key));
 });
 await t.test('preferences persist and logout revokes the session',async()=>{
  assert.equal((await call('/me/preferences',{session:userA,method:'PATCH',body:{theme:'light',listWidth:420}})).status,200);
  assert.equal((await call('/me',{session:userA})).data.user.preferences.listWidth,420);
  assert.equal((await call('/auth/logout',{session:userA,method:'POST',body:{}})).status,200);
  assert.equal((await call('/me',{session:userA})).status,401);
 });
 await pool.end();
});

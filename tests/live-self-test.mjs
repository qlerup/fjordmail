// Explicit live test: one message from test@gleruphub.dk to the same address.
// No third-party recipient, no secrets/content printed. The key arrives over stdin.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const {db}=await import('/app/dist-server/db.js');
const {seal}=await import('/app/dist-server/security.js');
const {storageReady}=await import('/app/dist-server/storage.js');
assert(process.env.FJORDMAIL_ISOLATED_TEST==='1');
let input='';for await(const chunk of process.stdin)input+=chunk;
const {key}=JSON.parse(input);
try{
 assert(await storageReady());
 await db.query("INSERT INTO provider_settings(id,api_key_cipher) VALUES('resend',$1) ON CONFLICT(id) DO UPDATE SET api_key_cipher=excluded.api_key_cipher",[seal(key)]);
 const base='http://app:8101',headers={Origin:base,'Content-Type':'application/json'};
 let r=await fetch(base+'/api/auth/login',{method:'POST',headers,body:JSON.stringify({username:'admin',password:process.env.FIRST_ADMIN_PASSWORD})});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];
 r=await fetch(base+'/api/me',{headers:{Cookie:cookie}});const profile=await r.json();const authenticated={...headers,Cookie:cookie,'X-CSRF-Token':profile.csrf};
 r=await fetch(base+'/api/admin/provider/test',{method:'POST',headers:authenticated,body:'{}'});assert.equal(r.status,200,'Provider domain verification');
 const domain=(await db.query("SELECT id FROM domains WHERE name='gleruphub.dk'")).rows[0];
 const box=(await db.query("INSERT INTO mailboxes(domain_id,local_part,display_name,kind) VALUES($1,'test','Live self test','personal') ON CONFLICT(domain_id,local_part) DO UPDATE SET display_name=excluded.display_name RETURNING id",[domain.id])).rows[0];
 await db.query('INSERT INTO mailbox_members(mailbox_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[box.id,profile.user.id]);
 r=await fetch(base+'/api/admin/mail/enable',{method:'POST',headers:authenticated,body:'{}'});assert.equal(r.status,200);
 const keyId=randomUUID(),subject='FjordMail forbindelsestest '+keyId;
 r=await fetch(base+'/api/mailboxes/'+box.id+'/send',{method:'POST',headers:authenticated,body:JSON.stringify({requestKey:keyId,to:['test@gleruphub.dk'],subject,text:'Automatisk forbindelsestest af FjordMail. Denne mail er sendt til testkontoen for at kontrollere afsendelse og modtagelse.'})});
 const result=await r.json();assert.equal(r.status,202,JSON.stringify(result));console.log('Live self-test queued.');
 let sent=false,received=false;
 for(let attempt=0;attempt<120;attempt++){
  await new Promise(resolve=>setTimeout(resolve,1000));
  const item=(await db.query('SELECT state,sent_id,last_error_code FROM mail_submissions WHERE id=$1',[result.id])).rows[0];
  if(['failed','uncertain','bounced'].includes(item.state))throw Error('Live send failed: '+item.last_error_code);
  sent=!!item.sent_id;
  if(attempt%5===0){const response=await fetch(base+'/api/mailboxes/'+box.id+'/messages?folder=inbox',{headers:authenticated});const data=await response.json();received=!!data.items?.some(v=>v.subject===subject);}
  if(sent&&received){console.log('PASS genuine Resend send, canonical Sent, API polling, genuine receiving, scanner and Inbox.');break;}
 }
 assert(sent&&received,'Live round trip did not complete');
}finally{await db.end();}

// Explicit isolated-fixture opt-in; never sends a real email or uses a provider key.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const {db}=await import('/app/dist-server/db.js');
const {provision,message,blob}=await import('/app/dist-server/engine.js');
const {buildComposition,composition}=await import('/app/dist-server/composition.js');
assert.equal(process.env.FJORDMAIL_ISOLATED_TEST,'1','Isolated fixture opt-in required');
const base='http://127.0.0.1:8101';let cookie='',csrf='';
async function call(path,method='GET',body,extra={}){
 const response=await fetch(base+'/api'+path,{method,headers:{Origin:base,Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json',...extra},body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body)});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
 return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
try{
 assert.equal((await db.query("SELECT count(*)::int AS n FROM provider_settings WHERE api_key_cipher IS NOT NULL")).rows[0].n,0,'No live provider credentials in fixture');
 const login=await call('/auth/login','POST',{username:'admin',password:process.env.FIRST_ADMIN_PASSWORD});assert.equal(login.status,200);cookie=login.cookie;assert(cookie);
 const me=await call('/me');csrf=me.data.csrf;const user=me.data.user.id;
 const mailbox=(await db.query("SELECT m.id FROM mailboxes m JOIN domains d ON d.id=m.domain_id WHERE m.local_part='fixture' AND d.name='gleruphub.dk'")).rows[0];assert(mailbox);const path='/mailboxes/'+mailbox.id;
 const file=Buffer.from('Isolated attachment fixture');const uploaded=await call(path+'/uploads?name=fixture.txt&type=text%2Fplain','POST',file,{'Content-Type':'application/octet-stream'});assert.equal(uploaded.status,201);assert.equal(uploaded.data.size,file.length);
 const draftId=randomUUID();const draft={revision:1,to:['recipient@example.org'],cc:['copy@example.org'],bcc:['hidden@example.org'],subject:'Composition fixture',text:'Persisted draft text',attachments:[uploaded.data],context:null};
 const save=await call(path+'/drafts/'+draftId,'PUT',draft);assert.equal(save.status,200,JSON.stringify(save.data));
 assert.equal((await call(path+'/drafts/'+draftId,'PUT',draft)).status,200,'Exact replay');
 assert.equal((await call(path+'/drafts/'+draftId,'PUT',{...draft,text:'Conflicting body'})).status,409,'Conflicting revision');
 const loaded=await call(path+'/drafts/'+draftId);assert.equal(loaded.status,200);assert.equal(loaded.data.text,draft.text);assert.deepEqual(loaded.data.bcc,draft.bcc);assert.equal(loaded.data.attachments[0].name,'fixture.txt');assert.equal(loaded.data.attachments[0].id,uploaded.data.id);
 const row=await provision(mailbox.id);const record=(await db.query('SELECT * FROM mail_drafts WHERE id=$1',[draftId])).rows[0];const engine=await message(row,record.engine_message_id);assert.equal((await blob(row,engine.attachments[0].blobId)).toString(),file.toString());
 const download=await call(path+'/messages/'+record.engine_message_id+'/attachments/'+engine.attachments[0].partId);assert.equal(download.status,200);assert.equal(download.data,file.toString());
 const built=await buildComposition(row,user,composition.parse(loaded.data),'<composition-fixture@example.org>');assert.deepEqual(built.provider.bcc,draft.bcc);assert.equal(Buffer.from(built.provider.attachments[0].content,'base64').toString(),file.toString());
 const changed=await call(path+'/drafts/'+draftId,'PUT',{...loaded.data,revision:2,text:'Changed draft text'});assert.equal(changed.status,200);
 const listing=await call(path+'/messages?folder=drafts');assert.equal(listing.data.items.filter(v=>v.draftId===draftId).length,1);
 const wrongUser=randomUUID();await assert.rejects(()=>buildComposition(row,wrongUser,composition.parse(loaded.data),'<wrong-user@example.org>'),e=>e.status===403);
 const eicar=Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');assert.equal((await call(path+'/uploads?name=eicar.txt&type=text%2Fplain','POST',eicar,{'Content-Type':'application/octet-stream'})).status,500);
 assert.equal((await call(path+'/drafts/'+draftId,'DELETE')).status,200);assert.equal((await call(path+'/drafts/'+draftId)).status,409);
 console.log('PASS actual encrypted engine draft save/replay/conflict/reopen, CC/BCC, attachment bytes/download, capability isolation, malware rejection, discard');
}finally{await db.end();}

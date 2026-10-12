// Run ONLY against the isolated fjordmail-phase2-check Compose fixture.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire('/app/package.json');
const MailComposer=require('nodemailer/lib/mail-composer');
const {db}=await import('/app/dist-server/db.js');
const {storageReady}=await import('/app/dist-server/storage.js');
const {provision,importMail,message,jmap,mailboxAuth}=await import('/app/dist-server/engine.js');
assert(process.env.FJORDMAIL_ISOLATED_TEST==='1','Fixture opt-in required');
assert(await storageReady());
try{
 const user=(await db.query("SELECT id FROM users WHERE username='admin'")).rows[0];
 const domain=(await db.query("INSERT INTO domains(name,sending_status) VALUES('gleruphub.dk','verified') ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id")).rows[0];
 const box=(await db.query("INSERT INTO mailboxes(domain_id,local_part,display_name,kind) VALUES($1,'fixture','Fixture Inbox','personal') ON CONFLICT(domain_id,local_part) DO UPDATE SET display_name=excluded.display_name RETURNING id",[domain.id])).rows[0];
 await db.query('INSERT INTO mailbox_members(mailbox_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[box.id,user.id]);
 const row=await provision(box.id);
 const raw=await new MailComposer({from:'fixture@example.org',to:'fixture@gleruphub.dk',subject:'Genuine engine fixture',text:'Persisted fixture content',messageId:'<fixture-two@example.org>'}).compile().build();
 const first=await importMail(row,raw,'inbox','fixture-receipt-two');
 const value=await message(row,first);assert.equal(value.subject,'Genuine engine fixture');
 const again=await importMail(row,raw,'inbox','fixture-receipt-two');assert.equal(first,again);
 console.log('PASS encrypted mount, Stalwart account, actual MIME import/read, replay deduplication');
 const all=await jmap('Email/get',{accountId:row.engine_id,ids:[first],properties:['headers','bodyValues','textBody'],fetchAllBodyValues:true},mailboxAuth(row));assert(JSON.stringify(all).includes('Persisted fixture content'));
}finally{await db.end();}

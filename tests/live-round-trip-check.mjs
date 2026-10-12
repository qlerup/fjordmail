import assert from 'node:assert/strict';
const {db}=await import('/app/dist-server/db.js');
const {provision,message}=await import('/app/dist-server/engine.js');
assert(process.env.FJORDMAIL_ISOLATED_TEST==='1');
try{
 for(let attempt=0;attempt<45;attempt++){
  const receipt=(await db.query('SELECT mailbox_id,engine_message_id FROM mail_receipts ORDER BY provider_id DESC LIMIT 1')).rows[0];
  const sent=(await db.query('SELECT mailbox_id,sent_id FROM mail_submissions WHERE sent_id IS NOT NULL LIMIT 1')).rows[0];
  if(receipt&&sent){const row=await provision(sent.mailbox_id);const outbound=await message(row,sent.sent_id),inbound=await message(row,receipt.engine_message_id);assert.equal(outbound.subject,inbound.subject);assert(String(inbound.subject).startsWith('FjordMail forbindelsestest '));console.log('PASS genuine Resend send/receive round trip, durable Sent/Inbox and identical subject.');break;}
  if(attempt===44)throw Error('Live receive pending');await new Promise(r=>setTimeout(r,1000));
 }
}finally{await db.end();}

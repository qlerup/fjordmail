import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
process.env.DATABASE_URL='postgresql://fixture:fixture@localhost/fixture';
process.env.APP_ENCRYPTION_KEY='test-only-key-012345678901234567890123456789';
const {verifyEvent,publicIPv4}=await import('../server/provider.js');
test('signed webhooks reject tampering and expired delivery timestamps',()=>{
 const key=randomBytes(32),secret='whsec_'+key.toString('base64'),payload=Buffer.from('{"type":"email.received","data":{"email_id":"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"}}');
 const timestamp=String(Math.floor(Date.now()/1000)),id='msg_fixture';
 const signature=createHmac('sha256',key).update(id+'.'+timestamp+'.'+payload.toString()).digest('base64');
 const headers={'svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+signature};
 assert(verifyEvent(payload,headers,secret));assert.throws(()=>verifyEvent(Buffer.from('{}'),headers,secret));
 assert.throws(()=>verifyEvent(payload,{...headers,'svix-timestamp':'1000'},secret));
});
test('provider DNS pinning excludes local and private IPv4 destinations',()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','172.16.1.2','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.1.2.3','::1'])assert.equal(publicIPv4(ip),false,ip);
 assert.equal(publicIPv4('1.1.1.1'),true);
});

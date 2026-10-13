import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL='postgresql://fixture:fixture@localhost/fixture';
process.env.APP_ENCRYPTION_KEY='test-only-key-012345678901234567890123456789';
const {pushEndpoint}=await import('../server/push.js');
test('Push subscriptions accept only explicit TLS push-service hosts',()=>{
 assert(pushEndpoint('https://fcm.googleapis.com/fcm/send/fixture'));
 assert(pushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/fixture'));
 assert(pushEndpoint('https://web.push.apple.com/fixture'));
 for(const url of ['http://fcm.googleapis.com/fcm/send/fixture','https://127.0.0.1/fixture','https://169.254.169.254/fixture','https://fcm.googleapis.com.evil.invalid/fixture','https://user:secret@fcm.googleapis.com/fixture','https://fcm.googleapis.com:8443/fixture','https://evil.invalid/fixture'])assert(!pushEndpoint(url));
});

import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL='postgresql://fixture:fixture@localhost/fixture';
process.env.APP_ENCRYPTION_KEY='test-only-key-012345678901234567890123456789';
const {seal,unseal,passwordHash,checkPassword}=await import('../server/security.js');
test('AES-256-GCM authenticates ciphertext and does not reuse nonces',()=>{
 const secret='re_fixture-not-a-real-secret';const first=seal(secret),second=seal(secret);
 assert.notEqual(first,second);assert.equal(unseal(first),secret);assert(!first.includes(secret));
 const parts=first.split('.');const data=Buffer.from(parts[2],'base64');data[0]^=1;parts[2]=data.toString('base64');assert.throws(()=>unseal(parts.join('.')));
});
test('password hashes use fresh salts and reject wrong passwords',async()=>{
 const first=await passwordHash('long-fixture-password'),second=await passwordHash('long-fixture-password');
 assert.notEqual(first,second);assert(await checkPassword('long-fixture-password',first));assert(!await checkPassword('wrong-password',first));
});

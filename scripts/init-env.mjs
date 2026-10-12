import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const key=()=>randomBytes(32).toString('base64url');
const password=key();
const content=`APP_PORT=8101\nBIND_ADDRESS=127.0.0.1\nDATA_DIR=./data\nPOSTGRES_PASSWORD=${password}\nAPP_ENCRYPTION_KEY=${key()}\nFIRST_ADMIN_PASSWORD=${key()}\nPUBLIC_URL=http://localhost:8101\nCOOKIE_SECURE=0\n`;
await writeFile('.env',content,{flag:'wx',mode:0o600});
console.log('Created .env. Local admin username: admin. Read FIRST_ADMIN_PASSWORD locally; do not share it.');

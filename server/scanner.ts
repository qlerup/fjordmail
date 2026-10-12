import {createConnection} from 'node:net';
import {env} from './config.js';
export async function scan(data:Buffer){
 await new Promise<void>((resolve,reject)=>{
  const socket=createConnection({host:env.CLAMD_HOST,port:env.CLAMD_PORT});let result='';socket.setTimeout(30000);
  socket.on('connect',()=>{socket.write(Buffer.from('zINSTREAM\0'));for(let offset=0;offset<data.length;offset+=65536){const part=data.subarray(offset,offset+65536);const size=Buffer.alloc(4);size.writeUInt32BE(part.length);socket.write(size);socket.write(part);}socket.write(Buffer.alloc(4));});
  socket.on('data',chunk=>{result+=chunk.toString();if(result.length>1024)socket.destroy(new Error('scan_response'));if(result.includes('\0')){socket.end();if(result.includes(': OK'))resolve();else reject(new Error(result.includes('FOUND')?'malware_found':'scan_failed'));}});
  socket.on('error',()=>reject(new Error('scanner_unavailable')));socket.on('timeout',()=>{socket.destroy();reject(new Error('scanner_timeout'));});socket.on('end',()=>{if(!result.includes('\0'))reject(new Error('scanner_incomplete'));});
 });
}

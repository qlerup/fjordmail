import {readFile} from 'node:fs/promises';
import {env} from './config.js';
import {db} from './db.js';
import {PublicError,unseal} from './security.js';
export async function storageReady(){
 if(env.MAIL_ENABLED!=='1')return false;
 try{
  const root=env.MAIL_STORAGE_ROOT.replace(/\/$/,'');
  const mounts=await readFile('/proc/self/mountinfo','utf8');
  const mounted=mounts.split('\n').some(line=>{const fields=line.split(' ');return fields[4]===root&&line.split(' - ')[1]?.startsWith('fuse.gocryptfs ');});
  if(!mounted)return false;
  const proof=(await readFile(root+'/.fjordmail-storage-proof','utf8')).trim();
  const data=JSON.parse(unseal(proof));if(data.format!==1||data.mountVerified!==true)return false;
  const value=(await db.query("SELECT pg_read_file('.fjordmail-storage-proof',0,4096,true) AS proof")).rows[0]?.proof;
  return value?.trim()===proof;
 }catch{return false;}
}
export async function requireStorage(){if(!await storageReady())throw new PublicError(503,'Mailbehandling afventer verificeret krypteret lager. Se Administration → Maildrift.');}
export async function processingReady(){return await storageReady()&&!!(await db.query('SELECT enabled FROM mail_controls WHERE id=true')).rows[0]?.enabled;}

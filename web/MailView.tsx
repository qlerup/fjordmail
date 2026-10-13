import {useEffect,useState} from 'react';
import {TestMail} from './TestMail';
import {OperationStatus} from './OperationStatus';
import type {Api} from './mail-types';
export function MailOperations({api}:{api:Api}){
 const [status,setStatus]=useState<{storageReady:boolean;enabled:boolean;jobs:{kind:string;state:string;count:string}[];failures:{id:string;kind:string;last_error_code:string}[]}|null>(null),[error,setError]=useState('');
 async function load(){try{setStatus(await api('/admin/mail'));}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();const timer=setInterval(()=>{void load();},10000);return()=>clearInterval(timer);},[]);
 async function retry(id:string){try{await api('/admin/mail/jobs/'+id+'/retry','POST',{});await load();setError('');}catch(e){setError((e as Error).message);}}
 async function change(action:string){try{await api('/admin/mail/'+action,'POST',{});await load();setError('');}catch(e){setError((e as Error).message);}}
 return <div className="panel"><h2>Maildrift</h2>{error&&<p className="alert">{error}</p>}<p>Krypteret lager: <strong>{status?.storageReady?'Kontrolleret':'FjordHub skal klargøre lageret'}</strong></p><p>Mailbehandling: <strong>{status?.enabled?'Aktiv':'Pauseret'}</strong></p><button className="primary" disabled={!status?.storageReady} onClick={()=>{void change(status?.enabled?'pause':'enable');}}>{status?.enabled?'Pause mailbehandling':'Aktivér mailbehandling'}</button><p className="fine">Opdatér FjordHub og derefter FjordMail for automatisk lageropsætning. Gem din Resend API-nøgle. Nye mails hentes automatisk cirka hvert 30. sekund. Et offentligt domæne er ikke nødvendigt. Webhooks er valgfrie.</p><p className="fine"><a href="https://github.com/qlerup/fjordmail#automatic-fjordhub-setup" target="_blank" rel="noreferrer">Automatisk opsætning via FjordHub</a></p><h3>Kø</h3>{status?.jobs.map(j=><p key={j.kind+j.state}>{j.kind} · {j.state}: {j.count}</p>)}{status?.failures.map(j=><p className="alert" key={j.id}>{j.kind}: {j.last_error_code} <button onClick={()=>void retry(j.id)}>Pr?v igen</button></p>)}<TestMail api={api} enabled={!!status?.enabled}/><OperationStatus api={api}/></div>;
}

import {useEffect,useRef,useState} from 'react';
import {requestId,type Api,type Draft,type Upload} from './mail-types';

const addresses=(value:string)=>value.split(/[;,]/).map(v=>v.trim()).filter(Boolean);
export function Composer({api,upload,mailbox,initial,onClose}:{api:Api;upload:Upload;mailbox:string;initial:Draft;onClose:()=>void}){
 const [draft,setDraft]=useState(initial),[to,setTo]=useState(initial.to.join(', ')),[cc,setCc]=useState(initial.cc.join(', ')),[bcc,setBcc]=useState(initial.bcc.join(', '));
 const [expanded,setExpanded]=useState(!!initial.cc.length||!!initial.bcc.length),[status,setStatus]=useState(initial.revision?'Kladde gemt':''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[queued,setQueued]=useState(false);
 const latest=useRef(draft),revision=useRef(initial.revision),saved=useRef(initial.revision?JSON.stringify(initial):''),chain=useRef(Promise.resolve()),pending=useRef<{revision:number;data:Draft;signature:string}|null>(null),active=useRef(true),locked=useRef(false),uploadLock=useRef(false),sendKey=useRef(requestId()),submission=useRef('');
 const fileInput=useRef<HTMLInputElement>(null);
 const oversized=draft.attachments.length>10||draft.attachments.some(f=>f.size>10000000)||draft.attachments.reduce((n,f)=>n+f.size,0)>15000000;
 latest.current={...draft,to:addresses(to),cc:addresses(cc),bcc:addresses(bcc)};
 function ensureSaved(){
  const next=chain.current.catch(()=>{}).then(async()=>{
   while(pending.current||JSON.stringify(latest.current)!==saved.current){
    const value=pending.current||{revision:revision.current+1,data:structuredClone(latest.current),signature:JSON.stringify(latest.current)};pending.current=value;
    if(active.current)setStatus('Gemmer kladde…');
    const result=await api<{revision:number}>('/mailboxes/'+mailbox+'/drafts/'+initial.id,'PUT',{...value.data,revision:value.revision});
    revision.current=result.revision;saved.current=value.signature;pending.current=null;
   }
   if(active.current){setStatus('Kladde gemt');setError('');}
  });chain.current=next;return next;
 }
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{if(queued||busy||uploading)return;const timer=setTimeout(()=>{void ensureSaved().catch(e=>{if(active.current){setError(e.message);setStatus('Kladden er ikke gemt');}});},1800);return()=>clearTimeout(timer);},[draft,to,cc,bcc,queued,busy,uploading]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(!queued&&(pending.current||JSON.stringify(latest.current)!==saved.current||uploadLock.current)){e.preventDefault();}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[queued]);
 async function close(){if(locked.current||uploadLock.current)return;locked.current=true;setBusy(true);try{if(!queued)await ensureSaved();onClose();}catch(e){setError((e as Error).message);}finally{locked.current=false;if(active.current)setBusy(false);}}
 async function discard(){if(locked.current||queued||uploadLock.current||!confirm('Slet denne kladde?'))return;locked.current=true;setBusy(true);try{if(revision.current||pending.current)await ensureSaved();else await chain.current.catch(()=>{});if(revision.current)await api('/mailboxes/'+mailbox+'/drafts/'+initial.id,'DELETE');onClose();}catch(e){setError((e as Error).message);}finally{locked.current=false;if(active.current)setBusy(false);}}
 async function addFiles(files:FileList|null){
  if(!files||uploadLock.current||locked.current||queued)return;uploadLock.current=true;setUploading(true);setError('');
  try{let current=latest.current.attachments;for(const file of Array.from(files)){
   if(current.length>=10||file.size>10000000||current.reduce((n,f)=>n+f.size,0)+file.size>15000000)throw Error('Højst 10 filer, 10 MB pr. fil og 15 MB i alt.');
   const added=await upload(mailbox,file);current=[...current,added];latest.current={...latest.current,attachments:current};setDraft(old=>({...old,attachments:current}));
  }}catch(e){setError((e as Error).message);}finally{uploadLock.current=false;if(active.current)setUploading(false);if(fileInput.current)fileInput.current.value='';}
 }
 async function send(event:React.FormEvent){
  event.preventDefault();if(locked.current||uploadLock.current||queued)return;locked.current=true;setBusy(true);setError('');
  try{await ensureSaved();const result=await api<{id:string}>('/mailboxes/'+mailbox+'/send','POST',{requestKey:sendKey.current,draftId:initial.id,draftRevision:revision.current});submission.current=result.id;setQueued(true);setStatus('Mailen ligger i afsendelseskøen.');
   for(let attempt=0;attempt<15;attempt++){await new Promise(resolve=>setTimeout(resolve,1000));const item=await api<{state:string;sent_id:string|null}>('/mailboxes/'+mailbox+'/submissions/'+result.id);
    if(!active.current)return;
    if(item.sent_id){setStatus(item.state==='delivered'?'Mailen er leveret og gemt i Sendt.':'Resend har accepteret mailen. Den er gemt i Sendt.');return;}
    if(item.state==='failed'||item.state==='uncertain'){setError('Afsendelsen kræver kontrol i Maildrift. Send ikke en ny kopi.');return;}
   }setStatus('Mailen behandles fortsat. Du kan lukke vinduet og se status i Maildrift.');
  }catch(e){setError((e as Error).message);}finally{locked.current=false;if(active.current)setBusy(false);}
 }
 return <form className="basic-compose" onSubmit={send} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void addFiles(e.dataTransfer.files);}}>
  <div className="reader-toolbar"><h2>{initial.context?.mode==='forward'?'Videresend':initial.context?'Svar':'Ny mail'}</h2><span/><button type="button" disabled={busy||uploading} onClick={()=>void close()}>Gem og luk</button></div>
  <fieldset disabled={busy||queued}><label>Til<input autoFocus value={to} onChange={e=>setTo(e.target.value)} placeholder="navn@domæne.dk" required/></label>
  <button className="text-button" type="button" onClick={()=>setExpanded(!expanded)}>{expanded?'Skjul CC / BCC':'Tilføj CC / BCC'}</button>
  {expanded&&<div className="compose-copy"><label>CC<input value={cc} onChange={e=>setCc(e.target.value)}/></label><label>BCC<input value={bcc} onChange={e=>setBcc(e.target.value)}/></label></div>}
  <label>Emne<input value={draft.subject} onChange={e=>setDraft({...draft,subject:e.target.value})} maxLength={998}/></label>
  <label>Besked<textarea value={draft.text} onChange={e=>setDraft({...draft,text:e.target.value})} maxLength={40000} rows={12}/></label>
  <div className="attachment-list">{draft.attachments.map(file=><div className="attachment" key={file.id}><span><strong>{file.name}</strong><small>{(file.size/1000000).toLocaleString('da-DK',{maximumFractionDigits:2})} MB</small></span><button type="button" disabled={uploading} aria-label={'Fjern '+file.name} onClick={()=>setDraft({...draft,attachments:draft.attachments.filter(f=>f.id!==file.id)})}>×</button></div>)}</div>
  <input ref={fileInput} className="file-input" type="file" multiple onChange={e=>void addFiles(e.target.files)} aria-label="Vedhæft filer"/>
  <button type="button" disabled={uploading} onClick={()=>fileInput.current?.click()}>{uploading?'Scanner og vedhæfter…':'Vedhæft filer'}</button>
  </fieldset>
  {oversized&&<p className="alert">Vedhæftningerne overskrider grænsen. Fjern filer, indtil der er højst 10 filer, 10 MB pr. fil og 15 MB i alt.</p>}{error&&<p className="alert" role="alert">{error}</p>}<p className="draft-status" role="status">{status}</p>
  <div className="compose-actions"><button className="primary" disabled={busy||uploading||queued||oversized}>{busy?'Behandler…':queued?'Sat i kø':'Send mail'}</button><button type="button" disabled={busy||uploading||queued} onClick={()=>void discard()}>Slet kladde</button>{!queued&&<button type="button" disabled={busy||uploading} onClick={()=>void ensureSaved().catch(e=>setError(e.message))}>Gem kladde</button>}</div>
  <p className="fine">Kladden gemmes automatisk. Filer: højst 10 MB pr. fil og 15 MB i alt.</p>
 </form>;
}

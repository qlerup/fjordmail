import {useEffect,useState} from 'react';
import type {Api} from './mail-types';
export function NotificationAccounts({api,mailbox}:{api:Api;mailbox:string}){
 const [accounts,setAccounts]=useState<{id:string;local_part:string;domain:string}[]>([]),[selected,setSelected]=useState<string[]>([]),[error,setError]=useState(''),[enabled,setEnabled]=useState(false);
 useEffect(()=>{let active=true;Promise.all([api<{items:typeof accounts}>('/mailboxes'),api<{user:{preferences:{notificationMailboxes?:string[];notifications?:boolean}}}>('/me')]).then(([list,profile])=>{if(active){setEnabled(!!profile.user.preferences.notifications);setAccounts(list.items);setSelected(profile.user.preferences.notificationMailboxes||list.items.map(m=>m.id));}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[api]);
 async function change(id:string,checked:boolean){const value=checked?[...selected,id]:selected.filter(v=>v!==id);try{await api('/me/preferences','PATCH',{notificationMailboxes:value});setSelected(value);window.dispatchEvent(new CustomEvent('fjordmail-notifications',{detail:enabled&&value.includes(mailbox)}));setError('');}catch(e){setError((e as Error).message);}}
 return <section><h3>Konti med notifikationer</h3>{error&&<p className="alert">{error}</p>}{accounts.map(m=><label className="select-all" key={m.id}><input type="checkbox" checked={selected.includes(m.id)} onChange={e=>void change(m.id,e.target.checked)}/>{m.local_part}@{m.domain}</label>)}</section>;
}

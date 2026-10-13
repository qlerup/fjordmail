export type Api=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
export type Address={name:string|null;email:string};
export type Attachment={id:string;name:string;type:string;size:number;token:string;partId?:string};
export type Context={mode:'reply'|'replyAll'|'forward';messageId:string}|null;
export type Draft={id:string;revision:number;to:string[];cc:string[];bcc:string[];subject:string;text:string;attachments:Attachment[];context:Context};
export type Summary={id:string;draftId?:string;subject:string;from:Address[];to:Address[];receivedAt:string;preview:string;keywords:Record<string,boolean>;hasAttachment:boolean};
export type Message=Summary&{text:string;cc:Address[];replyTo:Address[];attachments:Attachment[]};
export type Upload=(mailbox:string,file:File)=>Promise<Attachment>;
export function requestId(){const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
export function emptyDraft():Draft{return {id:requestId(),revision:0,to:[],cc:[],bcc:[],subject:'',text:'',attachments:[],context:null};}
export function replyDraft(value:Message,mode:'reply'|'replyAll'|'forward',own:string):Draft{
 const exclude=(values:Address[])=>(values||[]).map(v=>v.email).filter(v=>v.toLowerCase()!==own.toLowerCase());
 const primary=value.replyTo?.length?value.replyTo:value.from;
 const to=mode==='forward'?[]:[...new Set([...exclude(primary),...(mode==='replyAll'?exclude(value.to):[])])];
 const cc=mode==='replyAll'?[...new Set(exclude(value.cc))].filter(v=>!to.includes(v)):[];
 const prefix=mode==='forward'?'Fwd: ':'Re: ';const subject=/^(re|sv|fwd|vs):/i.test(value.subject)?value.subject:prefix+value.subject;
 const quotation='\n\n'+new Date(value.receivedAt).toLocaleString('da-DK')+' · '+(value.from||[]).map(v=>v.email).join(', ')+'\n'+value.text.split('\n').map(v=>'> '+v).join('\n');
 return {...emptyDraft(),to,cc,subject,text:quotation.slice(0,40000),attachments:mode==='forward'?value.attachments:[],context:{mode,messageId:value.id}};
}

import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db} from './db.js';
import {env,managed} from './config.js';
import {authenticate,admin,audit,bootstrap,cookie,session,syncHubUser} from './auth.js';
import {hubCall,hubIdentity} from './hub.js';
import {checkPassword,digest,passwordHash,PublicError,seal,unseal} from './security.js';
import {mailRoutes,mailAdminRoutes,webhook} from './mail-api.js';
import {processingReady} from './storage.js';

const uuid=z.string().uuid();
const login=z.object({username:z.string().min(1).max(128),password:z.string().min(1).max(256),first_login_email:z.string().max(254).default(''),first_login_password:z.string().max(256).default(''),first_login_password_confirm:z.string().max(256).default('')});
const preferences=z.object({theme:z.enum(['light','dark','system']).optional(),layout:z.enum(['columns','wide']).optional(),listWidth:z.number().min(260).max(600).optional(),notifications:z.boolean().optional()});
export function createApp(){
 const app=express();app.disable('x-powered-by');
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'","data:"],connectSrc:["'self'"],frameSrc:["'none'"],objectSrc:["'none'"],upgradeInsecureRequests:null}},referrerPolicy:{policy:'no-referrer'},strictTransportSecurity:env.COOKIE_SECURE==='1'?{maxAge:31536000}:false}));
 app.post('/api/webhooks/resend',express.raw({type:'application/json',limit:'256kb'}),webhook);
 app.use((req,_res,next)=>{if(['GET','HEAD','OPTIONS'].includes(req.method))return next();const origin=req.get('Origin');let allowed=false;
  try{const url=new URL(origin||'');allowed=['http:','https:'].includes(url.protocol)&&(url.host===req.get('Host')||origin===env.DEV_ORIGIN||origin===env.PUBLIC_URL);}catch{/* Missing origins are never trusted for cookie-authenticated writes. */}
  if(!allowed)throw new PublicError(403,'Forespørgslen kommer fra en anden webadresse.');next();});
 app.use(express.json({limit:'64kb'}));
 app.use('/api',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 app.get('/api/health',async(_req,res)=>{await db.query('SELECT 1');res.json({ok:true,version:'0.2.0',phase:'basic-mail'});});
 app.get('/api/bootstrap',async(_req,res)=>{res.json({managed,ready:managed||!!(await db.query('SELECT 1 FROM users LIMIT 1')).rowCount,capabilities:{webmail:await processingReady(),imap:false,smtp:false,ai:false},testDomain:'gleruphub.dk',testAddress:'test@gleruphub.dk'});});
 const limit=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'For mange loginforsøg. Prøv igen om lidt.'}});
 app.post('/api/auth/login',limit,async(req,res)=>{
  const data=login.parse(req.body);
  if(managed){const response=await hubCall('/api/hub/apps/authenticate',data);const profile=hubIdentity.parse(response.user);
   if(profile.email_required||profile.must_change_password){res.json({onboardingRequired:true,emailRequired:!!profile.email_required,passwordRequired:!!profile.must_change_password,error:profile.email_error||'Bekræft din email og vælg din personlige adgangskode.'});return;}
   const user=await syncHubUser(profile);await session(res,user);res.json({ok:true});return;}
  const user=(await db.query('SELECT * FROM users WHERE lower(username)=lower($1) AND hub_id IS NULL',[data.username])).rows[0];
  // Dummy hash work avoids fast user enumeration.
  const valid=await checkPassword(data.password,user?.password_hash||await passwordHash('invalid-placeholder-password'));
  if(!user||!valid)throw new PublicError(401,'Brugernavn eller adgangskode er forkert.');
  if(user.first_login){if(!data.first_login_email||!data.first_login_password){res.json({onboardingRequired:true,emailRequired:true,passwordRequired:true});return;}
   const email=z.string().email().max(254).parse(data.first_login_email);if(data.first_login_password!==data.first_login_password_confirm||data.first_login_password===data.password||data.first_login_password.length<12)throw new PublicError(400,'Vælg en ny adgangskode på mindst 12 tegn og gentag den ens.');
   const changed=await db.query('UPDATE users SET email=$1,password_hash=$2,first_login=false WHERE id=$3 AND first_login=true AND password_hash=$4',[email,await passwordHash(data.first_login_password),user.id,user.password_hash]);if(!changed.rowCount)throw new PublicError(401,'Første login blev allerede afsluttet. Log ind med din nye kode.');}
  await session(res,user);res.json({ok:true});
 });
 app.get(['/hub-login','/sso'],limit,async(req,res)=>{if(!managed)throw new PublicError(400,'FjordHub-login er ikke aktiveret.');const token=z.string().min(20).max(512).parse(req.query.token);const profile=await hubCall('/api/hub/sso-verify',{token},'GET');const user=await syncHubUser(profile);await session(res,user);res.redirect('/');});
 app.use('/api',authenticate);
 app.get('/api/me',(req,res)=>{res.json({user:{id:req.user!.id,username:req.user!.username,email:req.user!.email,role:req.user!.role,preferences:req.user!.preferences},csrf:req.csrf});});
 app.post('/api/auth/logout',async(req,res)=>{await db.query('DELETE FROM sessions WHERE token_hash=$1',[digest(cookie(req))]);res.clearCookie('fjordmail_session',{path:'/',secure:env.COOKIE_SECURE==='1',httpOnly:true,sameSite:'lax'});res.json({ok:true});});
 app.patch('/api/me/preferences',async(req,res)=>{const data=preferences.parse(req.body);await db.query('UPDATE users SET preferences=preferences||$1::jsonb WHERE id=$2',[JSON.stringify(data),req.user!.id]);res.json({ok:true});});
 app.get('/api/mailboxes',async(req,res)=>{res.json({items:(await db.query('SELECT m.id,m.domain_id,m.local_part,m.display_name,m.kind,m.provision_status,m.created_at,d.name AS domain,a.permission FROM mailboxes m JOIN domains d ON d.id=m.domain_id JOIN mailbox_members a ON a.mailbox_id=m.id WHERE a.user_id=$1 ORDER BY m.display_name',[req.user!.id])).rows});});
 app.use('/api/mailboxes',mailRoutes());
 app.use('/api/admin',admin);
 app.use('/api/admin/mail',mailAdminRoutes());
 app.get('/api/admin/users',async(_req,res)=>{if(managed){const items=(await hubCall('/api/hub/apps/users',{},'GET')).items;for(const value of Array.isArray(items)?items:[]){const p=hubIdentity.parse(value);if(!p.email_required&&!p.must_change_password)await syncHubUser(p);}}
  res.json({managed,items:(await db.query('SELECT id,username,email,role,first_login FROM users ORDER BY username')).rows});});
 app.post('/api/admin/users',async(req,res)=>{if(managed)throw new PublicError(403,'Opret og tildel brugere i FjordHub.');const data=z.object({username:z.string().regex(/^[a-zA-Z0-9_.-]{2,64}$/),password:z.string().min(12).max(256),role:z.enum(['admin','user']).default('user')}).parse(req.body);const result=await db.query('INSERT INTO users(username,role,password_hash,first_login) VALUES($1,$2,$3,true) RETURNING id',[data.username,data.role,await passwordHash(data.password)]);await audit(req.user!.id,'user.create',result.rows[0].id);res.status(201).json({id:result.rows[0].id});});
 app.get('/api/admin/domains',async(_req,res)=>{res.json({items:(await db.query('SELECT * FROM domains ORDER BY name')).rows});});
 app.post('/api/admin/domains',async(req,res)=>{const data=z.object({name:z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/)}).parse(req.body);const result=await db.query('INSERT INTO domains(name) VALUES($1) RETURNING id',[data.name]);await audit(req.user!.id,'domain.create',result.rows[0].id);res.status(201).json({id:result.rows[0].id});});
 app.get('/api/admin/mailboxes',async(_req,res)=>{res.json({items:(await db.query('SELECT m.id,m.domain_id,m.local_part,m.display_name,m.kind,m.provision_status,m.created_at,d.name AS domain,coalesce(jsonb_agg(jsonb_build_object(\'user_id\',a.user_id,\'permission\',a.permission)) FILTER(WHERE a.user_id IS NOT NULL),\'[]\') AS members FROM mailboxes m JOIN domains d ON d.id=m.domain_id LEFT JOIN mailbox_members a ON a.mailbox_id=m.id GROUP BY m.id,d.name ORDER BY m.display_name')).rows});});
 app.post('/api/admin/mailboxes',async(req,res)=>{
  const data=z.object({domainId:uuid,localPart:z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._+-]{0,63}$/),displayName:z.string().trim().min(1).max(100),kind:z.enum(['personal','shared']),userIds:z.array(uuid).min(1).max(100)}).parse(req.body);
  if(data.kind==='personal'&&new Set(data.userIds).size!==1)throw new PublicError(400,'En personlig konto skal have præcis én ejer.');
  const client=await db.connect();try{await client.query('BEGIN');const result=await client.query('INSERT INTO mailboxes(domain_id,local_part,display_name,kind) VALUES($1,$2,$3,$4) RETURNING id',[data.domainId,data.localPart,data.displayName,data.kind]);for(const user of new Set(data.userIds))await client.query('INSERT INTO mailbox_members(mailbox_id,user_id) VALUES($1,$2)',[result.rows[0].id,user]);await client.query('INSERT INTO audit_log(actor_id,action,target) VALUES($1,$2,$3)',[req.user!.id,'mailbox.create',result.rows[0].id]);await client.query('COMMIT');res.status(201).json({id:result.rows[0].id});}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 });
 app.put('/api/admin/mailboxes/:id/members',async(req,res)=>{const id=uuid.parse(req.params.id);const members=z.array(z.object({userId:uuid,permission:z.enum(['read','write'])})).min(1).max(100).parse(req.body.members);const client=await db.connect();try{await client.query('BEGIN');const row=(await client.query('SELECT kind FROM mailboxes WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row)throw new PublicError(404,'Mailkontoen findes ikke.');if(row.kind==='personal'&&members.length!==1)throw new PublicError(400,'Personlige konti har én ejer.');await client.query('DELETE FROM mailbox_members WHERE mailbox_id=$1',[id]);for(const m of members)await client.query('INSERT INTO mailbox_members(mailbox_id,user_id,permission) VALUES($1,$2,$3)',[id,m.userId,m.permission]);await client.query('INSERT INTO audit_log(actor_id,action,target) VALUES($1,$2,$3)',[req.user!.id,'mailbox.members',id]);await client.query('COMMIT');res.json({ok:true});}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}});
 async function provider(){const row=(await db.query("SELECT * FROM provider_settings WHERE id='resend'")).rows[0];return {key:env.RESEND_API_KEY||(row?.api_key_cipher?unseal(row.api_key_cipher):''),secret:env.RESEND_WEBHOOK_SECRET||(row?.webhook_secret_cipher?unseal(row.webhook_secret_cipher):''),checkedAt:row?.checked_at};}
 app.get('/api/admin/provider',async(_req,res)=>{const data=await provider();res.json({hasApiKey:!!data.key,hasWebhookSecret:!!data.secret,environmentApiKey:!!env.RESEND_API_KEY,environmentWebhookSecret:!!env.RESEND_WEBHOOK_SECRET,checkedAt:data.checkedAt||null,webhookPath:'/api/webhooks/resend',receivingReady:await processingReady()});});
 app.put('/api/admin/provider',async(req,res)=>{const data=z.object({apiKey:z.string().regex(/^re_[A-Za-z0-9_-]{8,256}$/).optional(),webhookSecret:z.string().regex(/^whsec_[A-Za-z0-9+/=_-]{8,256}$/).optional()}).refine(d=>d.apiKey||d.webhookSecret,'Udfyld mindst én nøgle.').parse(req.body);
  if((data.apiKey&&env.RESEND_API_KEY)||(data.webhookSecret&&env.RESEND_WEBHOOK_SECRET))throw new PublicError(409,'Nøglen styres via miljøvariabel. Fjern den dér før ændring i appen.');
  await db.query("INSERT INTO provider_settings(id,api_key_cipher,webhook_secret_cipher) VALUES('resend',$1,$2) ON CONFLICT(id) DO UPDATE SET api_key_cipher=coalesce(excluded.api_key_cipher,provider_settings.api_key_cipher),webhook_secret_cipher=coalesce(excluded.webhook_secret_cipher,provider_settings.webhook_secret_cipher),checked_at=NULL,updated_at=now()",[data.apiKey?seal(data.apiKey):null,data.webhookSecret?seal(data.webhookSecret):null]);await audit(req.user!.id,'provider.configure','resend');res.json({ok:true});});
 app.post('/api/admin/provider/test',async(req,res)=>{const config=await provider();if(!config.key)throw new PublicError(400,'Gem først din Resend API-nøgle.');let response;try{response=await fetch('https://api.resend.com/domains',{headers:{Authorization:'Bearer '+config.key},signal:AbortSignal.timeout(10000),redirect:'error'});}catch{throw new PublicError(502,'Resend kunne ikke kontaktes. Prøv igen.');}if(!response.ok)throw new PublicError(502,response.status===401?'Resend afviste API-nøglen.':'Resend kunne ikke levere domæner. Nøglen skal have Full access.');const parsed=z.object({data:z.array(z.object({id:z.string(),name:z.string(),status:z.string(),capabilities:z.object({sending:z.string(),receiving:z.string()}).optional()}))}).parse(await response.json());
  for(const domain of parsed.data)await db.query('UPDATE domains SET provider_id=$1,sending_status=$2,receiving_status=$3 WHERE name=$4',[domain.id,domain.capabilities?.sending||domain.status,domain.capabilities?.receiving||'not_checked',domain.name.toLowerCase()]);await db.query("INSERT INTO provider_settings(id,checked_at) VALUES('resend',now()) ON CONFLICT(id) DO UPDATE SET checked_at=now()");await audit(req.user!.id,'provider.test','resend');res.json({ok:true,domains:parsed.data.map(d=>({name:d.name,status:d.status,capabilities:d.capabilities}))});});
 app.get('/api/admin/status',async(_req,res)=>{const counts=(await db.query("SELECT (SELECT count(*) FROM users) AS users,(SELECT count(*) FROM domains) AS domains,(SELECT count(*) FROM mailboxes) AS mailboxes,(SELECT count(*) FROM jobs WHERE state='dead') AS failed_jobs")).rows[0];res.json({phase:'basic-mail',counts,mailEngine:'stalwart',protocols:{imap:'not_enabled',smtp:'not_enabled'},mailProcessing:await processingReady()?'active':'paused',storage:'Stalwart canonical storage planned; metadata in PostgreSQL'});});
 app.get('/api/admin/audit',async(_req,res)=>{res.json({items:(await db.query('SELECT a.id,a.action,a.target,a.created_at,u.username FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100')).rows});});
 // Do not acknowledge Resend deliveries before the durable receiving pipeline exists.
 app.use('/api',(_req,res)=>res.status(404).json({error:'API-adressen findes ikke.'}));
 app.use(express.static('dist',{index:false}));app.get('/',(_req,res)=>res.sendFile('index.html',{root:'dist'}));
 app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  if(error instanceof PublicError){res.status(error.status).json({error:error.message});return;}
  if(error instanceof z.ZodError){res.status(400).json({error:'Kontrollér de udfyldte felter.'});return;}
  const code=typeof error==='object'&&error&&'code'in error?String(error.code):'';
  if(['23505','23503'].includes(code)){res.status(409).json({error:code==='23505'?'Navnet eller adressen er allerede oprettet.':'En valgt bruger eller et domæne findes ikke.'});return;}
  const id=randomUUID();console.error('request_error',{id,code:code||'internal'});res.status(500).json({error:'Handlingen kunne ikke gennemføres.',reference:id});
 });return app;
}
export {bootstrap};

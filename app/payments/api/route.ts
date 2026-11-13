import {ensureProjects,projectKey} from '@/lib/payments/projects';
import {startFresh} from '@/lib/payments/fresh-start';
import {randomBytes,randomUUID} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {transaction,totals,type Ledger,type Role,type Entry,type Expense} from '@/lib/payments/store';
import {companyView,bdtFromUsd,today} from '@/lib/payments/company';
import {roleFor,invited,passwordRecord,matches,session,newSession,digest} from '@/lib/payments/auth';
export const runtime='nodejs';export const dynamic='force-dynamic';
const cookieName='bb_payments';
class InputError extends Error{constructor(message:string,public status=400){super(message)}}
function respond(data:unknown,status=200){return NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'}})}
function workers(db:Ledger){db.workers??={};db.workers.royal??={name:'Royal',emailHash:'',opening:db.opening};return db.workers;}
function selected(db:Ledger,role:Role,w:unknown){const id=typeof w==='string'&&w?w:(role==='admin'?'royal':role);if(role!=='admin'&&id!==role)throw new InputError('Access denied.',403);if(!workers(db)[id])throw new InputError('Worker not found.',404);if(id==='royal')startFresh(db);return id;}
function view(db:Ledger,role:Role,w?:unknown){const id=selected(db,role,w),profile=workers(db)[id];const entries=db.entries.filter(e=>(e.workerId||'royal')===id);const history=db.history?.[id];
const projects=ensureProjects(db,id).map(p=>role==='admin'?p:{...p,clientPaidUsd:undefined});
const live=totals({opening:profile.opening,entries});
return{projects,role,workerId:id,name:profile.name,hourlyRate:profile.hourlyRate??25000,settingsVersion:profile.settingsVersion??0,active:!!db.users[id],history:db.history?.[id]||null,workers:role==='admin'?Object.entries(workers(db)).map(([id,w])=>({id,name:w.name,active:!!db.users[id]})):[],names:{admin:'Administrator',[id]:profile.name},opening:profile.opening,entries,audit:db.audit.filter(a=>(a.workerId||'royal')===id).slice(-100).reverse(),totals:live,syncedAt:new Date().toISOString()};}
function requireRole(db:Ledger,req:NextRequest){const role=session(db,req.cookies.get(cookieName)?.value);if(!role)throw new InputError('Please sign in.',401);return role;}
function text(v:unknown,max=300){if(typeof v!=='string'||v.length>max)throw new InputError('Invalid text.');return v.trim();}
function secret(v:unknown){if(typeof v!=='string'||v.length>200)throw new InputError('Invalid password.');return v;}
function date(v:unknown){const d=text(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw new InputError('Choose a valid date.');return d;}
function integer(v:unknown,min:number,max:number){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)throw new InputError('Enter a valid amount or time.');return v;}
function audit(db:Ledger,by:Role,action:string,before:unknown,after:unknown,workerId='royal'){db.audit.push({workerId,at:new Date().toISOString(),by,action,before,after});}
function error(e:unknown){if(e instanceof InputError)return respond({error:e.message},e.status);console.error('Payment ledger unavailable',e instanceof Error?e.message:'storage');return respond({error:'The ledger is temporarily unavailable. Nothing was saved. Please retry.'},503);}
export async function GET(req:NextRequest){try{return await transaction(db=>{const role=requireRole(db,req);
 if(req.nextUrl.searchParams.get('view')==='company'){if(role!=='admin')throw new InputError('Access denied.',403);return respond(companyView(db));}
 return respond(view(db,role,req.nextUrl.searchParams.get('worker')));})}catch(e){return error(e)}}
export async function POST(req:NextRequest){
 try{
  // Require a same-origin browser JSON request. Cookie auth is never accepted cross-origin.
  const origin=req.headers.get('origin');const allowed=process.env.LEDGER_ORIGIN||(process.env.NODE_ENV==='production'?'https://bloombrainmedia.com':req.nextUrl.origin);
  if(origin!==allowed||!req.headers.get('content-type')?.startsWith('application/json'))throw new InputError('Request not allowed.',403);
  const raw=await req.text();if(raw.length>200000)throw new InputError('Request too large.',413);
  let b;try{b=JSON.parse(raw)}catch{throw new InputError('Invalid request.')}
  if(!b||typeof b!=='object')throw new InputError('Invalid request.');
  return await transaction(async db=>{
   if(b.action==='login'||b.action==='setup'){
    const email=text(b.email,254),password=secret(b.password);if(password.length<12)throw new InputError('Use a password with at least 12 characters.');
    const role=roleFor(email,db);const bucket=role||'unknown';const now=Date.now();
    let limit=db.attempts[bucket];if(!limit||limit.until<now)limit=db.attempts[bucket]={count:0,until:now+15*60000};
    if(limit.count>=10)return respond({error:'Too many attempts. Try again in 15 minutes.'},429);
    limit.count++;
    if(!role)return respond({error:'Email, password or invitation is not valid.'},401);
    if(b.action==='setup'){
     if(db.users[role]||!invited(role,text(b.invite,128),db))return respond({error:'Invitation is invalid, expired, or already used. Please sign in if you already set a password.'},401);
     db.users[role]=await passwordRecord(password);audit(db,role,'Account activated',null,{role},role==='admin'?'royal':role);
    }else if(!db.users[role]||!(await matches(password,db.users[role]!)))return respond({error:'Email or password is not valid.'},401);
    delete db.attempts[bucket];const token=newSession(db,role);const res=respond(view(db,role));res.cookies.set(cookieName,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/payments',maxAge:7*86400});return res;
   }
   const role=requireRole(db,req);
   if(b.action==='logout'){const h=digest(req.cookies.get(cookieName)?.value||'');db.sessions=db.sessions.filter(s=>s.hash!==h);const res=respond({ok:true});res.cookies.set(cookieName,'',{path:'/payments',maxAge:0,httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production'});return res;}
   if(b.action==='password'){
    const old=secret(b.oldPassword),password=secret(b.password);if(password.length<12)throw new InputError('Use at least 12 characters.');if(!(await matches(old,db.users[role]!)))throw new InputError('Current password is incorrect.');db.users[role]=await passwordRecord(password);db.sessions=db.sessions.filter(s=>s.role!==role);const token=newSession(db,role);audit(db,role,'Password changed',null,null,role==='admin'?selected(db,role,b.worker):role);const res=respond(view(db,role));res.cookies.set(cookieName,token,{path:'/payments',httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',maxAge:7*86400});return res;
   }
   if(b.action==='addWorker'){
    if(role!=='admin')throw new InputError('Only the admin can add workers.',403);
    const name=text(b.name,100),email=text(b.email,254).toLowerCase();
    if(!name||!/^\S+@\S+\.\S+$/.test(email))throw new InputError('Enter worker name and valid email.');
    if(roleFor(email,db))throw new InputError('This email already has an account.',409);
    const id='worker-'+randomUUID(),token=randomBytes(32).toString('hex');
    workers(db)[id]={hourlyRate:integer(b.hourlyRate??25000,1,100000000),settingsVersion:0,name,emailHash:digest(email),inviteHash:digest(token),expires:Date.now()+14*86400000,opening:{amount:integer(b.amount,-100000000,100000000),date:date(b.date),note:'Opening balance set by administrator'}};
    audit(db,role,'Worker added',null,{name},id);
    return respond({...view(db,role,id),setupUrl:allowed+'/worker#invite='+token});
   }
   // Company-wide admin actions (spend, settings, client income). Answer with the company view.
   if(['saveExpense','voidExpense','companySettings','projectIncome'].includes(b.action)){
    if(role!=='admin')throw new InputError('Only the administrator can do this.',403);
    db.expenses??=[];db.settings??={};
    if(b.action==='companySettings'){const before={...db.settings};db.settings.usdRate=integer(b.usdRate,100,100000000);audit(db,role,'Company USD rate updated',before,{...db.settings},'company');}
    if(b.action==='projectIncome'){
     const project=(db.projects||[]).find(p=>p.id===b.id);if(!project)throw new InputError('Project not found.',404);
     if(project.version!==b.version)throw new InputError('Project changed. Refresh and try again.',409);
     const before={...project};project.clientPaidUsd=b.usd===null?undefined:integer(b.usd,0,1000000000);project.version++;
     audit(db,role,'Client payment updated',before,{...project},project.workerId);
    }
    if(b.action==='saveExpense'){
     const id=text(b.id,40);if(!/^[a-f0-9-]{36}$/.test(id))throw new InputError('Invalid entry ID.');
     const old=db.expenses.find(x=>x.id===id);
     if(old){if(old.voided||old.version!==b.version)throw new InputError('Someone updated this expense. Refresh before editing.',409);}
     else if(b.version!==0)throw new InputError('Expense no longer exists.',409);
     const category=text(b.category,60);if(!category)throw new InputError('Choose a category.');
     const now=new Date().toISOString();
     const expense:Expense={id,date:date(b.date),category,description:text(b.description),usd:integer(b.usd,1,1000000000),version:(old?.version||0)+1,voided:false,by:role,createdAt:old?.createdAt||now,updatedAt:now};
     if(old)db.expenses[db.expenses.indexOf(old)]=expense;else db.expenses.push(expense);
     audit(db,role,old?'Expense edited':'Expense added',old||null,expense,'company');
    }
    if(b.action==='voidExpense'){
     const old=db.expenses.find(x=>x.id===b.id);if(!old||old.voided||old.version!==b.version)throw new InputError('Expense changed. Refresh and try again.',409);
     const before={...old};old.voided=true;old.version++;old.updatedAt=new Date().toISOString();audit(db,role,'Expense voided',before,{...old},'company');
    }
    return respond(companyView(db));
   }
   const workerId=selected(db,role,b.worker);const profile=workers(db)[workerId];
   const projects=ensureProjects(db,workerId);
   if(b.action==='createProject'){
    const client=text(b.client,120),name=text(b.name,120);if(!client||!name)throw new InputError('Enter client and project name.');
    if(projects.some(p=>projectKey(p.client)===projectKey(client)&&projectKey(p.name)===projectKey(name)))throw new InputError('This project already exists. Use Add hours on its card.',409);
    const project={id:randomUUID(),workerId,client,name,status:'active' as const,version:1,createdAt:new Date().toISOString()};db.projects!.push(project);
    audit(db,role,'Project created',null,project,workerId);return respond(view(db,role,workerId));
   }
   if(b.action==='projectStatus'){
    const project=projects.find(p=>p.id===b.id);if(!project)throw new InputError('Project not found.',404);
    if(project.version!==b.version)throw new InputError('Project changed. Refresh and try again.',409);
    if(!['active','paused','completed'].includes(b.status))throw new InputError('Invalid project status.');
    const before={...project};project.status=b.status;project.version++;if(b.status==='completed')project.deliveredAt??=today();else delete project.deliveredAt;
    audit(db,role,'Project status changed',before,{...project},workerId);return respond(view(db,role,workerId));
   }
   if(b.action==='inviteWorker'){
    if(role!=='admin')throw new InputError('Only the administrator can create an invitation.',403);
    if(db.users[workerId])throw new InputError('This worker is already activated. Use the sign-in page.',409);
    const token=randomBytes(32).toString('hex');profile.inviteHash=digest(token);profile.expires=Date.now()+14*86400000;
    audit(db,role,'Worker invitation renewed',null,{expires:profile.expires},workerId);
    return respond({...view(db,role,workerId),setupUrl:allowed+'/worker#invite='+token});
   }
   if(b.action==='workerSettings'){
    if(role!=='admin')throw new InputError('Only the administrator can change rates and opening balances.',403);
    if(b.settingsVersion!==(profile.settingsVersion??0))throw new InputError('Settings changed. Refresh and try again.',409);
    const hourlyRate=integer(b.hourlyRate,1,100000000),opening={amount:integer(b.amount,-100000000,100000000),date:date(b.date),note:text(b.note)};
    const before={hourlyRate:profile.hourlyRate??25000,opening:profile.opening};
    profile.hourlyRate=hourlyRate;profile.opening=opening;profile.settingsVersion=(profile.settingsVersion??0)+1;
    audit(db,role,'Rate and opening balance updated',before,{hourlyRate,opening},workerId);
    return respond(view(db,role,workerId));
   }
   if(b.action==='opening'){
    if(role!=='admin')throw new InputError('Only the admin can set the opening balance.',403);
    if(profile.opening)throw new InputError('Opening balance is already set.',409);
    profile.opening={amount:integer(b.amount,-100000000,100000000),date:date(b.date),note:text(b.note)};audit(db,role,'Opening balance set',null,profile.opening,workerId);return respond(view(db,role,workerId));
   }
   if(!profile.opening)throw new InputError('Ask the admin to set the opening balance first.',409);
   const old=db.entries.find(e=>e.id===b.id);
   if(old&&(old.workerId||'royal')!==workerId)throw new InputError('Access denied.',403);
   if(b.action==='void'){
    if(role!=='admin')throw new InputError('Only the admin can void an entry.',403);
    if(!old||old.voided||old.version!==b.version)throw new InputError('Entry changed. Refresh and try again.',409);
    const before={...old};old.voided=true;old.version++;old.updatedAt=new Date().toISOString();audit(db,role,'Entry voided',before,{...old},workerId);return respond(view(db,role,workerId));
   }
   if(b.action!=='save')throw new InputError('Unknown action.');
   const id=text(b.id,40);if(!/^[a-f0-9-]{36}$/.test(id))throw new InputError('Invalid entry ID.');
   if(old){if(old.voided||old.version!==b.version)throw new InputError('Someone updated this entry. Refresh before editing.',409);if(role!=='admin'&&old.by!==role)throw new InputError('You can edit only your own entries.',403);}
   else if(b.version!==0)throw new InputError('Entry no longer exists.',409);
   if(b.kind!=='work'&&b.kind!=='payment')throw new InputError('Choose work or payment.');
   const minutes=b.kind==='work'?integer(b.minutes,1,60000):0;
   let client=text(b.client||'',120),projectId:string|undefined,projectName:string|undefined;
   if(b.kind==='work'){
    const requested=old?.projectId||text(b.projectId||'',40);
    let project=requested?projects.find(p=>p.id===requested):undefined;
    if(requested&&!project)throw new InputError('Project not found.',404);
    if(!project){
     if(!client)throw new InputError('Client name is required.');
     const name=text(b.projectName||'General work',120)||'General work';
     project=projects.find(p=>projectKey(p.client)===projectKey(client)&&projectKey(p.name)===projectKey(name));
     if(!project){project={id:randomUUID(),workerId,client,name,status:'active',version:1,createdAt:new Date().toISOString()};db.projects!.push(project);audit(db,role,'Project created',null,{...project},workerId);}
    }
    if(!old&&project.status==='completed')throw new InputError('Reopen this completed project before adding hours.',409);
    projectId=project.id;projectName=project.name;client=project.client;
   }
   // Payments may be sent in USD: keep the dollars and the rate, convert once to paisa.
   const usd=b.kind==='payment'&&b.currency==='USD'?integer(b.usd,1,1000000000):undefined,usdRate=usd?integer(b.usdRate,100,100000000):undefined;
   const hourlyRate=b.kind==='work'?(old?.hourlyRate??(old?25000:profile.hourlyRate??25000)):undefined;
   const entry:Entry={workerId,id,projectId,projectName,hourlyRate,kind:b.kind,date:date(b.date),client,description:text(b.description),minutes,amount:b.kind==='work'?Math.round(minutes*hourlyRate!/60):usd?bdtFromUsd(usd,usdRate!):integer(b.amount,1,100000000),usd,usdRate,reference:text(b.reference,100),by:old?.by||role,version:(old?.version||0)+1,voided:false,createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
   if(old&&old.kind!==entry.kind)throw new InputError('Entry type cannot change.');
   if(old)db.entries[db.entries.indexOf(old)]=entry;else db.entries.push(entry);
   audit(db,role,old?'Entry edited':'Entry added',old||null,entry,workerId);return respond(view(db,role,workerId));
  });
 }catch(e){return error(e)}
}

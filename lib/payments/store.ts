import type {SheetHistory} from './history';
import {promises as fs} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
export type Role=string;
export type Worker={hourlyRate?:number;settingsVersion?:number;name:string;emailHash:string;inviteHash?:string;expires?:number;opening:Ledger['opening']};
export type Project={id:string;workerId:string;client:string;name:string;status:'active'|'paused'|'completed';version:number;createdAt:string;deliveredAt?:string;clientPaidUsd?:number};
// Company spend, recorded by the admin in US cents.
export type Expense={id:string;date:string;category:string;description:string;usd:number;version:number;voided:boolean;by:Role;createdAt:string;updatedAt:string};
export type Entry={projectId?:string;projectName?:string;workerId?:string;id:string;kind:'work'|'payment';hourlyRate?:number;date:string;client:string;description:string;minutes:number;amount:number;reference:string;by:Role;version:number;voided:boolean;createdAt:string;updatedAt:string;usd?:number;usdRate?:number};
export type Ledger={version:number;projects?:Project[];expenses?:Expense[];settings?:{usdRate?:number;clientRate?:number;feeBps?:number};freshStart?:{at:string;opening:Ledger['opening'];history?:SheetHistory;entries:Entry[];audit:Ledger['audit']};history?:Record<string,SheetHistory>;workers?:Record<string,Worker>;users:Partial<Record<Role,{salt:string;hash:string}>>;sessions:{hash:string;role:Role;expires:number}[];attempts:Record<string,{count:number;until:number}>;opening:null|{amount:number;date:string;note:string};entries:Entry[];audit:{workerId?:string;at:string;by:Role;action:string;before:unknown;after:unknown}[]};
export const directory=process.env.LEDGER_DATA_DIR||path.join(homedir(),'.bloombrain-private','payments');
const filename=path.join(directory,'ledger.json');
function initialOpening():Ledger['opening']{
 const amount=process.env.LEDGER_OPENING_PAISA,date=process.env.LEDGER_OPENING_DATE;
 if(!amount&&!date)return null;
 const n=Number(amount);
 if(!amount||!date||!Number.isSafeInteger(n)||Math.abs(n)>100000000||!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date).toISOString().slice(0,10)!==date)throw new Error('Invalid opening configuration');
 return {amount:n,date,note:'Owner-confirmed balance carried forward from the previous sheet'};
}
export const empty=():Ledger=>({version:1,users:{},sessions:[],attempts:{},opening:initialOpening(),entries:[],audit:[]});
// Supabase is the primary store when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// set (see lib/payments/supabase.ts). Without them the private file store is used.
export async function transaction<T>(fn:(db:Ledger)=>Promise<T>|T):Promise<T>{
 const {supabaseConfigured,supabaseTransaction}=await import('./supabase');
 return supabaseConfigured()?supabaseTransaction(fn):fileTransaction(fn);
}
// Existing file ledger, used to seed Supabase once when its table is still empty.
export async function readFileLedger():Promise<Ledger|null>{
 try{const db=JSON.parse(await fs.readFile(filename,'utf8'));if(db.version!==1||!Array.isArray(db.entries))throw new Error('Invalid ledger');return db;}
 catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
}
// A shared filesystem lock serializes writers across Node processes. A live lock is
// never stolen; crashed owners can be recovered after their PID no longer exists.
async function fileTransaction<T>(fn:(db:Ledger)=>Promise<T>|T):Promise<T>{
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 const lock=path.join(directory,'.lock');let acquired=false;
 for(let i=0;i<100;i++){
  try{await fs.mkdir(lock,{mode:0o700});acquired=true;await fs.writeFile(path.join(lock,'owner'),String(process.pid),{mode:0o600});break;}
  catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
   try{const age=Date.now()-(await fs.stat(lock)).mtimeMs;if(age>30000){const pid=Number(await fs.readFile(path.join(lock,'owner'),'utf8'));if(pid>0){try{process.kill(pid,0)}catch(err){if((err as NodeJS.ErrnoException).code==='ESRCH')await fs.rm(lock,{recursive:true,force:true});}}}}catch{}
   await new Promise(r=>setTimeout(r,50));
  }
 }
 if(!acquired)throw new Error('BUSY');
 try{
  let db:Ledger;let original='';
  try{original=await fs.readFile(filename,'utf8');db=JSON.parse(original);if(db.version!==1||!Array.isArray(db.entries))throw new Error('Invalid ledger');}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')db=empty();else throw e;}
  const result=await fn(db);const updated=JSON.stringify(db);
  if(updated!==original){
   if(original){const backups=path.join(directory,'backups');await fs.mkdir(backups,{mode:0o700,recursive:true});await fs.writeFile(path.join(backups,`${Date.now()}-${randomBytes(4).toString('hex')}.json`),original,{mode:0o600});const files=(await fs.readdir(backups)).sort();for(const f of files.slice(0,-100))await fs.unlink(path.join(backups,f));}
   const tmp=filename+'.'+randomBytes(8).toString('hex');const h=await fs.open(tmp,'wx',0o600);try{await h.writeFile(updated);await h.sync();}finally{await h.close();}await fs.rename(tmp,filename);
  }
  return result;
 }finally{await fs.rm(lock,{recursive:true,force:true});}
}
export function totals(db:Pick<Ledger,'opening'|'entries'>){const work=db.entries.filter(e=>!e.voided&&e.kind==='work');const payments=db.entries.filter(e=>!e.voided&&e.kind==='payment');const earned=work.reduce((a,e)=>a+e.amount,0),paid=payments.reduce((a,e)=>a+e.amount,0);return{minutes:work.reduce((a,e)=>a+e.minutes,0),earned,paid,balance:(db.opening?.amount||0)+earned-paid};}

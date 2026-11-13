import {empty,readFileLedger,type Ledger} from './store';

// The whole ledger is one JSON document, exactly like the file store. Writes use
// optimistic concurrency: ledger_commit() only succeeds when the row's revision is
// unchanged, otherwise the transaction is re-run on fresh data. Every change keeps
// the previous document in ledger_backups (latest 100). Schema: supabase/schema.sql.
// The service-role key is server-only and must never be exposed to the browser.
const ROW='main';
export function supabaseConfigured(){return !!(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY);}
async function rest(path:string,init:RequestInit={}){
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY!;
 const headers:Record<string,string>={apikey:key,'Content-Type':'application/json',...(init.headers as Record<string,string>)};
 if(key.startsWith('eyJ'))headers.Authorization='Bearer '+key; // legacy JWT keys; sb_secret_ keys use apikey only
 const res=await fetch(process.env.SUPABASE_URL!.replace(/\/+$/,'')+'/rest/v1/'+path,{...init,headers,cache:'no-store'});
 const body=await res.text();
 if(!res.ok)throw new Error(`Supabase ${res.status}: ${body.slice(0,200)}`);
 return body?JSON.parse(body):null; // return=minimal responses have no body
}
async function load():Promise<{data:Ledger;rev:number}|null>{
 const rows=await rest(`ledger_store?id=eq.${ROW}&select=data,rev`) as {data:Ledger;rev:number}[];
 return rows[0]||null;
}
async function seed(){
 // First run: carry over the existing private file ledger (if this host has one).
 const data=(await readFileLedger())||empty();
 await rest('ledger_store?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({id:ROW,data,rev:0})});
}
export async function supabaseTransaction<T>(fn:(db:Ledger)=>Promise<T>|T):Promise<T>{
 for(let attempt=0;attempt<8;attempt++){
  let row=await load();
  if(!row){await seed();row=await load();if(!row)throw new Error('Ledger row missing');}
  const db=row.data;if(db?.version!==1||!Array.isArray(db.entries))throw new Error('Invalid ledger'); // fail closed
  const original=JSON.stringify(db);
  const result=await fn(db);
  if(JSON.stringify(db)===original)return result;
  const ok=await rest('rpc/ledger_commit',{method:'POST',body:JSON.stringify({p_id:ROW,p_rev:row.rev,p_data:db})});
  if(ok===true)return result;
  await new Promise(r=>setTimeout(r,40+Math.random()*120)); // another request saved first: retry on fresh data
 }
 throw new Error('BUSY');
}

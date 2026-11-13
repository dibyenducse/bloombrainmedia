// Company dashboard API test. LOCAL server only, empty ledger, ignored invitations:
//   node scripts/create-payment-invites.mjs admin@test.local worker@test.local
//   LEDGER_DATA_DIR=$(mktemp -d) LEDGER_ORIGIN=http://127.0.0.1:5370 npx next start -p 5370
//   node scripts/test-company.mjs   (then: git checkout lib/payments/invitations.json)
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const base='http://127.0.0.1:5370';
const links=readFileSync('.payment-invitations.txt','utf8');
const emails=[...links.matchAll(/\(([^)]+@[^)]+)\)/g)].map(m=>m[1]),tokens=[...links.matchAll(/#invite=([a-f0-9]+)/g)].map(m=>m[1]);
const pw='Local-test-only-7391!';
async function post(body,cookie=''){const r=await fetch(base+'/payments/api',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:JSON.stringify(body)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
const get=(q,cookie)=>fetch(base+'/payments/api'+q,{headers:{Cookie:cookie}}).then(async r=>({status:r.status,data:await r.json()}));
const admin=(await post({action:'setup',email:emails[0],password:pw,invite:tokens[0]})).cookie;
const royal=(await post({action:'setup',email:emails[1],password:pw,invite:tokens[1]})).cookie;
assert.ok(admin&&royal);
let r=await post({worker:'royal',action:'opening',amount:0,date:'2026-11-01',note:'test'},admin);assert.equal(r.status,409,'royal opening already set by fresh start');
r=await post({action:'addWorker',name:'Sumon',email:'sumon@test.local',hourlyRate:30000,amount:0,date:'2026-11-01'},admin);const sumon=r.data.workerId;
// Admin creates and assigns projects for the same client to different workers.
r=await post({worker:'royal',action:'createProject',client:'Mark',name:'Reel 1'},admin);const p1=r.data.projects.find(p=>p.name==='Reel 1');
r=await post({worker:sumon,action:'createProject',client:'Mark',name:'Reel 2'},admin);const p2=r.data.projects.find(p=>p.name==='Reel 2');
assert.equal(p1.workerId,'royal');assert.equal(p2.workerId,sumon);
// Workers log hours; a worker can also create their own project.
r=await post({action:'save',id:randomUUID(),version:0,kind:'work',projectId:p1.id,date:'2026-11-03',client:'',minutes:150,amount:0,description:'',reference:''},royal);assert.equal(r.status,200);assert.equal(r.data.totals.earned,62500);
r=await post({action:'createProject',client:'Own client',name:'Self made'},royal);assert.equal(r.status,200);
r=await post({worker:sumon,action:'save',id:randomUUID(),version:0,kind:'work',projectId:p2.id,date:'2026-11-05',client:'',minutes:120,amount:0,description:'',reference:''},admin);assert.equal(r.data.totals.earned,60000);
// Royal cannot log on Sumon's project or see the company view.
assert.equal((await post({worker:sumon,action:'save',id:randomUUID(),version:0,kind:'work',projectId:p2.id,date:'2026-11-05',client:'',minutes:60,amount:0,description:'',reference:''},royal)).status,403);
assert.equal((await get('?view=company',royal)).status,403);
assert.equal((await post({action:'saveExpense',id:randomUUID(),version:0,date:'2026-11-02',category:'AI tools',description:'x',usd:2000},royal)).status,403);
// USD payment: $50 at 122.50 -> 6125 BDT.
r=await post({worker:'royal',action:'save',id:randomUUID(),version:0,kind:'payment',currency:'USD',usd:5000,usdRate:12250,date:'2026-11-06',client:'',minutes:0,amount:0,description:'',reference:'Payoneer'},admin);
assert.equal(r.status,200);const pay=r.data.entries.find(e=>e.kind==='payment');assert.equal(pay.amount,612500);assert.equal(pay.usd,5000);assert.equal(r.data.totals.balance,62500-612500);
// Delivered date, client income (hidden from worker), expenses, settings.
r=await post({worker:'royal',action:'projectStatus',id:p1.id,version:p1.version,status:'completed'},admin);const done=r.data.projects.find(p=>p.id===p1.id);assert.match(done.deliveredAt,/^\d{4}-\d{2}-\d{2}$/);
r=await post({action:'projectIncome',id:p1.id,version:done.version,usd:12000},admin);assert.equal(r.status,200);assert.equal(r.data.projects.find(p=>p.id===p1.id).clientPaidUsd,12000);
const mine=(await get('',royal)).data;assert.equal(mine.projects.find(p=>p.id===p1.id).clientPaidUsd,undefined,'worker must not see client income');
const xid=randomUUID();
r=await post({action:'saveExpense',id:xid,version:0,date:'2026-11-02',category:'AI tools',description:'Kling',usd:2999},admin);assert.equal(r.status,200);
assert.equal((await post({action:'saveExpense',id:xid,version:0,date:'2026-11-02',category:'AI tools',description:'Kling',usd:2999},admin)).status,409,'double submit');
r=await post({action:'saveExpense',id:randomUUID(),version:0,date:'2026-11-04',category:'Upwork Connects',description:'80 connects',usd:1200},admin);
const v=r.data.expenses.find(x=>x.id===xid);r=await post({action:'voidExpense',id:v.id,version:v.version},admin);assert.equal(r.data.expenses.find(x=>x.id===xid).voided,true);
r=await post({action:'companySettings',usdRate:12300},admin);assert.equal(r.data.usdRate,12300);
const c=(await get('?view=company',admin)).data;
assert.equal(c.workers.length,2);assert.equal(c.workers.find(w=>w.id==='royal').balance,62500-612500);
assert.equal(c.projects.find(p=>p.id===p1.id).minutes,150);assert.equal(c.projects.find(p=>p.id===p2.id).workerName,'Sumon');
assert.equal(c.expenses.filter(x=>!x.voided).reduce((a,x)=>a+x.usd,0),1200);
console.log('Company dashboard test passed.');

// Storage regression test for the payments ledger. Run against a LOCAL server only,
// with either backend (file store or Supabase), on an empty ledger:
//   node scripts/create-payment-invites.mjs admin@test.local worker@test.local
//   npm run build && npx next start -p 5370   (with or without SUPABASE_* set)
//   node scripts/test-ledger-storage.mjs
// Afterwards restore lib/payments/invitations.json with git checkout.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const base=process.env.TEST_LEDGER_URL||'http://127.0.0.1:5370';
if(!base.startsWith('http://127.0.0.1:'))throw new Error('Local test server only');
const origin=process.env.TEST_LEDGER_ORIGIN||'https://bloombrainmedia.com';
const links=readFileSync('.payment-invitations.txt','utf8');
const email=[...links.matchAll(/\(([^)]+@[^)]+)\)/g)][0][1],invite=[...links.matchAll(/#invite=([a-f0-9]+)/g)][0][1];
const pw='Local-test-only-7391!';
async function post(body,cookie=''){const r=await fetch(base+'/payments/api',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},body:JSON.stringify(body)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
assert.equal((await fetch(base+'/payments/api')).status,401);
let r=await post({action:'setup',email,password:pw,invite});assert.equal(r.status,200,JSON.stringify(r.data));const admin=r.cookie;
assert.equal((await post({action:'setup',email,password:pw,invite})).status,401,'invite is single use');
r=await post({action:'addWorker',name:'Test Worker',email:'second@test.local',hourlyRate:30000,amount:100000,date:'2026-11-01'},admin);assert.equal(r.status,200,JSON.stringify(r.data));
const worker=r.data.workerId;assert.match(r.data.setupUrl,/#invite=[a-f0-9]{64}$/);
// Concurrent writes must all be kept (no lost updates).
const N=20;const results=await Promise.all(Array.from({length:N},(_,i)=>post({worker,action:'save',id:randomUUID(),version:0,kind:'payment',date:'2026-11-05',client:'',minutes:0,amount:1000*(i+1),description:'Concurrent payment '+i,reference:'t'},admin)));
assert.deepEqual(results.map(x=>x.status),Array(N).fill(200));
const work={worker,action:'save',id:randomUUID(),version:0,kind:'work',date:'2026-11-06',client:'Demo client',projectName:'Demo',minutes:90,amount:0,description:'Edit',reference:''};
r=await post(work,admin);assert.equal(r.status,200);assert.equal((await post(work,admin)).status,409,'double submit rejected');
const paid=N*(N+1)/2*1000;assert.equal(r.data.totals.paid,paid);assert.equal(r.data.totals.earned,45000);assert.equal(r.data.totals.balance,100000+45000-paid);
const entry=r.data.entries.find(e=>e.id===work.id);r=await post({worker,action:'void',id:entry.id,version:entry.version},admin);assert.equal(r.status,200);assert.equal(r.data.totals.earned,0);
assert.equal((await post({action:'logout'},admin)).status,200);
assert.equal((await fetch(base+'/payments/api',{headers:{Cookie:admin}})).status,401,'session revoked');
r=await post({action:'login',email,password:pw});assert.equal(r.status,200);
r=await fetch(base+'/payments/api?worker='+worker,{headers:{Cookie:r.cookie}}).then(x=>x.json());
assert.equal(r.entries.length,N+1);assert.equal(r.totals.balance,100000-paid);
console.log('Ledger storage test passed:',JSON.stringify(r.totals));

// Run with fake-indexeddb installed, or SAGE_TEST_NODE_MODULES pointing to its node_modules.
// Isolated browser/worker contexts share a real IndexedDB-compatible transactional store.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
let IDBFactory;
try { ({IDBFactory}=await import('fake-indexeddb')); }
catch { ({IDBFactory}=await import(pathToFileURL(`${process.env.SAGE_TEST_NODE_MODULES}/fake-indexeddb/build/esm/index.js`))); }
const scheduler=await readFile(new URL('../src/js/sage-scheduler.js',import.meta.url),'utf8');
const memory=await readFile(new URL('../src/js/sage-memory.js',import.meta.url),'utf8');
const now=new Date(2026,8,28,9).getTime();
const day=86400000;
const Clock=class extends Date {static now(){return now;}};
function sched(db=new IDBFactory(),notes=[]) {
  const root={indexedDB:db,Date:Clock,console,setTimeout,clearTimeout,
    registration:{getNotifications:async()=>notes}};
  root.self=root;vm.runInNewContext(scheduler,root);
  return root.SageScheduler;
}
const plan={id:'munnar',text:'Ride to Munnar tomorrow',at:now,when:now+day,daysLeft:1};
test('page and worker enqueue concurrently without losing either item',async()=>{
  const db=new IDBFactory(),a=sched(db),b=sched(db);
  await Promise.all([a.enqueue('planReminder',{key:'a'}),b.enqueue('planReminder',{key:'b'})]);
  assert.deepEqual((await a.getQueue()).map(e=>e.key).sort(),['a','b']);
});
test('page and worker deliver one reminder; same plan/day cannot be requeued',async()=>{
  const db=new IDBFactory(),a=sched(db),b=sched(db);let sent=0;
  await a.checkPlans([plan]);
  const send=async()=>{sent++;await new Promise(r=>setTimeout(r,40));return true;};
  await Promise.all([a.deliver(send),b.deliver(send)]);
  assert.equal(sent,1);assert.equal((await a.getQueue()).length,0);
  await b.checkPlans([plan]);assert.equal((await a.getQueue()).length,0);
  assert.equal((await a.getState()).sentLog.length,1);
});
test('refresh preserves failed-send backoff and attempt count',async()=>{
  const a=sched();await a.checkPlans([plan]);
  assert.equal(await a.deliver(async()=>false),false);
  const before=(await a.getQueue())[0];assert.equal(before.attempts,1);
  await a.checkPlans([plan]);const after=(await a.getQueue())[0];
  assert.equal(after.earliestSend,before.earliestSend);assert.equal(after.attempts,1);assert.equal(after.id,before.id);
  let sent=0;await a.deliver(async()=>{sent++;return true;});assert.equal(sent,0);
});
test('deleting last plan cancels queued and selected reminders and closes old notifications',async()=>{
  let closed=0;const a=sched(undefined,[{data:{category:'planReminder',planId:'munnar'},close(){closed++;}},
    {data:{category:'planReminder'},close(){closed++;}},{data:{category:'service'},close(){throw Error('unrelated');}}]);
  await a.checkPlans([plan]);closed=0;
  const selected=await a.drain();assert.ok(selected);
  await a.checkPlans([]);
  assert.equal(await a.validDelivery(selected.entry),false);assert.equal((await a.getQueue()).length,0);assert.equal(closed,2);
});
test('expired and previous-day plan reminders are never delivered',async()=>{
  const a=sched();await a.checkPlans([plan]);
  const selected=await a.drain();assert.equal(await a.validDelivery(selected.entry,now+day),false);
  await a.checkPlans([plan],now+day);assert.equal((await a.getQueue()).length,0);
});
test('same reminder has a stable OS notification tag across contexts/retries',async()=>{
  const a=sched();await a.checkPlans([plan]);const e=(await a.getQueue())[0];
  assert.equal(a.notificationTag(e),a.notificationTag({...e,id:'retry',attempts:4}));
  assert.notEqual(a.notificationTag(e),a.notificationTag({...e,key:'another-plan'}));
});
function mem(facts=[],remote=[]) {
  const values=new Map([['sage_memory',JSON.stringify({v:2,facts,episodes:[{id:'ep',learned:facts.map(f=>f.text),dirty:false}],recap:{text:'Munnar trip is planned',rev:1}})]]);
  let rows=structuredClone(remote),deny=false;
  const client={from(){let op='select',payload,filters=[];const q={select(){return q;},limit(){return q;},
    eq(k,v){filters.push(r=>r[k]===v);return q;},in(k,vs){filters.push(r=>vs.includes(r[k]));return q;},
    upsert(v){op='upsert';payload=v;return q;},delete(){op='delete';return q;},
    then(resolve,reject){try{
      let result={data:rows.filter(r=>filters.every(f=>f(r))),error:null};
      if(op==='delete') {if(deny)result.error={code:'42501',message:'test denied'};else rows=rows.filter(r=>!filters.every(f=>f(r)));}
      if(op==='upsert')for(const row of payload){rows=rows.filter(r=>r.mem_key!==row.mem_key);rows.push(structuredClone(row));}
      return Promise.resolve(result).then(resolve,reject);
    }catch(e){return Promise.reject(e).then(resolve,reject);}}};return q;}};
  const root={console,Date:Clock,localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},
    setTimeout:()=>0,clearTimeout(){},addEventListener(){},document:{readyState:'loading',addEventListener(){}},supabaseClient:client};
  root.self=root;vm.runInNewContext(memory,root);
  return {m:root.SageMemory,get rows(){return rows;},set deny(value){deny=value;}};
}
const fact=(id,patch={})=>({id,text:`Ride to ${id}`,kind:'plan',at:now,expiresAt:now+day,...patch});
const row=f=>({mem_key:f.id,record_type:'fact',content:f.text,kind:f.kind,learned_at:new Date(f.at).toISOString(),expires_at:f.expiresAt?new Date(f.expiresAt).toISOString():null,archived_at:f.archivedAt?new Date(f.archivedAt).toISOString():null,rev:1});
test('forget plan hard deletes its fact, learned copy and recap; cloud DELETE completes',async()=>{
  const f=fact('munnar'),h=mem([f],[row(f),{mem_key:'recap',record_type:'recap',content:'Trip'}]);
  h.m.forget(f.id);assert.equal(h.m.read().facts.length,0);assert.equal(h.m.read().recap,null);
  assert.equal(h.m.read().episodes[0].learned.length,0);assert.ok(h.m.read().tombstones.includes(f.id));
  await h.m.push();assert.ok(!h.rows.some(r=>r.mem_key===f.id||r.mem_key==='recap'));assert.equal(h.m.read().tombstones.length,0);
});
test('expired and previously archived plans are purged even when pinned; unrelated facts remain',()=>{
  const h=mem([fact('past',{expiresAt:now-1,pinned:true}),fact('forgotten',{archivedAt:now-1}),fact('future'),
    fact('brother',{kind:'fact',expiresAt:null})]);
  h.m.sweep({force:true});assert.deepEqual(Array.from(h.m.read().facts,f=>f.id),['future','brother']);
  assert.deepEqual(Array.from(h.m.upcomingPlans(),f=>f.id),['future']);
});
test('old tomorrow plan loses legacy two-day grace and is permanently removed',()=>{
  const h=mem([fact('munnar',{text:'He is planning a ride to Munnar tomorrow',at:now-2*day,expiresAt:now+day})]);
  h.m.sweep({force:true});assert.equal(h.m.read().facts.length,0);
});
test('cloud forgotten plans are not offered for recovery and are physically deleted on sync',async()=>{
  const old=fact('old',{archivedAt:now-1}),past=fact('past',{expiresAt:now-1}),live=fact('future');
  const h=mem([],[row(old),row(past),row(live)]);const remote=await h.m.listRemote();
  assert.equal(remote.forgotten.length,0);assert.deepEqual(Array.from(remote.restorable,e=>e.key),['future']);
  await h.m.push();assert.deepEqual(h.rows.filter(r=>r.record_type==='fact').map(r=>r.mem_key),['future']);
});
test('failed cloud deletion retains tombstone and cannot resurrect plan during pull',async()=>{
  const f=fact('munnar'),h=mem([f],[row(f)]);h.deny=true;h.m.forget(f.id);await h.m.push();
  assert.ok(h.m.read().tombstones.includes(f.id));await h.m.pull();assert.equal(h.m.read().facts.length,0);
  h.deny=false;await h.m.push();assert.ok(!h.rows.some(r=>r.mem_key===f.id));
});
test('normal forgetting of a non-plan remains recoverable',()=>{
  const h=mem([fact('friend',{kind:'fact',expiresAt:null})]);h.m.forget('friend');
  assert.ok(h.m.read().facts[0].archivedAt);assert.equal(h.m.read().tombstones.length,0);
});

test('cloud summary excludes expired plans before restore badge is painted',async()=>{
  const h=mem([],[row(fact('past',{expiresAt:now-1})),row(fact('future'))]);
  const summary=await h.m.remoteSummary();assert.equal(summary.facts,1);assert.equal(summary.missingHere,1);
  assert.ok(h.m.read().tombstones.includes('past'));
});

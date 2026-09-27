// Voice scheduling and request-budget tests with deferred provider responses.
// No credentials or network. node --test tools/audit-sage-voice-latency.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/js/sage-ai.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(check){for(let i=0;i<100;i++){if(check())return;await tick();}assert.ok(check(),'request did not start');}
const answer=text=>({ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text}]},finishReason:'STOP'}]})});
function harness(fetch){
  const storage=new Map(), delays=[], timers=new Set(), requests=[];
  const root={console:{log(){},warn(){}},navigator:{onLine:true},AbortController,
    document:{querySelectorAll:()=>[]},
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    setTimeout(fn,ms){delays.push(ms);const t=setTimeout(fn,ms<10000?1:ms);timers.add(t);return t;},clearTimeout,
    fetch:async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});return fetch(url,init,requests.length);}};
  root.self=root;vm.runInNewContext(source,root);
  root.SageAI.addKey('fake-test-key-one');
  return {AI:root.SageAI,delays,requests,cleanup(){timers.forEach(clearTimeout);}};
}

test('voice starts while background HTTP is pending; ordinary requests remain serialized',async()=>{
  let finishBackground;
  const h=harness((url,init,n)=>n===1?new Promise(resolve=>{finishBackground=()=>resolve(answer('background'));}):answer('ready bro.'));
  try {
    const background=h.AI.generate('background',{purpose:'auto',system:'test'});
    await until(()=>finishBackground);
    const ordinary=h.AI.generate('ordinary',{purpose:'chat',system:'test'});
    h.AI.noteThinkingRefused(h.AI.DEFAULT_MODEL); // old thinkingBudget rejection must not suppress the new level control
    const voice=h.AI.askSage('hello',{voice:true,tools:false,maxTokens:480});
    await until(()=>h.requests.length===2);
    assert.equal((await voice).ok,true);
    assert.equal(h.requests.length,2,'ordinary request is still behind background');
    assert.ok(h.delays.includes(12000),'voice uses shorter request timeout');
    assert.ok(h.delays.some(ms=>ms>1000 && ms<=1500),'shared start spacing remains');
    assert.equal(h.requests[1].body.generationConfig.thinkingConfig.thinkingLevel,'low');
    finishBackground();await background;await ordinary;
    assert.equal(h.requests.length,3);
  } finally {h.cleanup();}
});

test('voice failure walk stops after three provider attempts, including config retries',async()=>{
  const h=harness(async(url,init,n)=>({ok:false,status:n===1?400:503}));
  try {
    const reply=await h.AI.askSage('hello',{voice:true,tools:false});
    assert.equal(reply.ok,false);
    assert.equal(h.requests.length,3);
  } finally {h.cleanup();}
});

test('tool results still precede the spoken answer in the fast request lane',async()=>{
  const h=harness(async(url,init,n)=>n===1?{ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{functionCall:{name:'read_service',args:{}}}]},finishReason:'STOP'}]})}:answer('Service is due tomorrow.'));
  try {
    let called=false;
    const reply=await h.AI.converse({voice:true,purpose:'chat',system:'test',history:[{role:'user',text:'When is service?'}],tools:[{name:'read_service',description:'Read service',parameters:{type:'OBJECT',properties:{}}}],onTool:async()=>{called=true;return {date:'tomorrow'};}});
    assert.equal(called,true);assert.equal(reply.ok,true);
    assert.equal(h.requests[1].body.contents.at(-1).parts[0].functionResponse.response.date,'tomorrow');
  } finally {h.cleanup();}
});

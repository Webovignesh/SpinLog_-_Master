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
    assert.ok(!h.delays.some(ms=>ms>0 && ms<=1500),'different model does not wait behind background');
    assert.match(h.requests[1].url,/gemini-3.5-flash-lite/);
    assert.equal(h.requests[1].body.generationConfig.thinkingConfig.thinkingLevel,'minimal');
    finishBackground();await background;await ordinary;
    assert.equal(h.requests.length,3);
    assert.ok(h.delays.some(ms=>ms>0 && ms<=1500),'same model retains start spacing');
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

test('spoken answers preserve Tamil script and instruct full regional phrases',async()=>{
  const h=harness(async()=>answer('சொல்லு டா, என்ன விஷயம்?'));
  try {const reply=await h.AI.askSage('நான் பேசுறது கேக்குதா',{voice:true});
    assert.equal(reply.ok,true);assert.match(reply.text,/சொல்லு டா/);
    const system=JSON.stringify(h.requests[0].body.systemInstruction);
    assert.match(system,/Chennai/);assert.match(system,/Theni/);assert.match(system,/sollu da/);
  } finally {h.cleanup();}
});

const quota=(violations,retryDelay='65s')=>({ok:false,status:429,headers:{get:()=>null},json:async()=>({error:{details:[{violations},{retryDelay}]}})});
test('model quota falls through to another model without resting the key or clearing the quota',async()=>{
  const h=harness(async(url,init,n)=>n===1?quota([{quotaId:'GenerateRequestsPerMinutePerProjectPerModel',quotaDimensions:{model:'gemini-3.5-flash-lite'}}]):answer('சொல்லு டா'));
  try{const at=Date.now(),reply=await h.AI.askSage('hello',{voice:true,tools:false});
    assert.equal(reply.ok,true);assert.equal(h.requests.length,2);
    assert.match(h.requests[1].url,/gemini-3.5-flash:/);
    assert.equal(h.AI.availableKeys().length,1);
    const rest=h.AI.readBackoff().models['gemini-3.5-flash-lite'];
    assert.equal(rest.kind,'quota');assert.ok(rest.until>=at+65000);
    await h.AI.askSage('next',{voice:true,tools:false});
    assert.match(h.requests[2].url,/gemini-3.5-flash:/,'do not retry the capped model');
  }finally{h.cleanup();}
});
test('project-wide and mixed quotas preserve whole-key cooldown and retry metadata',async()=>{
  for(const violations of [[],[{quotaId:'DailyProjectSpend'}],[{quotaDimensions:{model:'gemini-3.5-flash-lite'}},{quotaId:'DailyProjectSpend'}]]){
    const h=harness(async()=>quota(violations,'120s'));
    try{const reply=await h.AI.askSage('hello',{voice:true,tools:false});
      assert.equal(reply.ok,false);assert.equal(reply.reason,'backoff');
      assert.ok(reply.retryInMs>119000);assert.equal(h.requests.length,1);
      assert.equal(h.AI.availableKeys().length,0);
    }finally{h.cleanup();}
  }
});
test('resting full chat models and an older catalog cannot block the voice Lite route',async()=>{
  const h=harness(async()=>answer('ready bro'));
  try{h.AI.setKnownModels(h.AI.MODEL_CHAIN);h.AI.MODEL_CHAIN.forEach(m=>h.AI.noteModelUnavailable(m));
    assert.equal(h.AI.ready().ok,false);
    const reply=await h.AI.askSage('hello',{voice:true,tools:false});
    assert.equal(reply.ok,true);assert.match(h.requests[0].url,/gemini-3.5-flash-lite/);
  }finally{h.cleanup();}
});


test('an older in-flight success cannot erase a newer project quota cooldown',async()=>{
  let finishBackground;
  const h=harness(async(url,init,n)=>n===1?new Promise(resolve=>{finishBackground=()=>resolve(answer('background'));}):quota([{quotaId:'DailyProjectSpend'}],'120s'));
  try{
    const background=h.AI.generate('background',{purpose:'auto',system:'test'});
    await until(()=>finishBackground);
    const voice=await h.AI.askSage('hello',{voice:true,tools:false});
    assert.equal(voice.reason,'backoff');
    finishBackground();await background;
    assert.equal(h.AI.availableKeys().length,0,'late success preserves active quota rest');
  }finally{h.cleanup();}
});

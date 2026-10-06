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
  return {root,AI:root.SageAI,delays,requests,cleanup(){timers.forEach(clearTimeout);}};
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

test('multiple stored documents arrive as readable attachments rather than base64 in tool results',async()=>{
  const h=harness(async(url,init,n)=>n===1?{ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{functionCall:{name:'read_documents',args:{offset:0}}}]},finishReason:'STOP'}]})}:answer('I read both files.'));
  try {
    const reply=await h.AI.converse({voice:true,purpose:'chat',system:'test',history:[{role:'user',text:'read all my docs'}],
      tools:[{name:'read_documents',parameters:{type:'OBJECT',properties:{}}}],
      onTool:async()=>({ok:true,complete:true,documents:[{document:'RC',read:true},{document:'Policy',read:true}],_attachFiles:[
        {name:'RC',mimeType:'application/pdf',data:'UkM='},{name:'Policy',mimeType:'image/png',data:'UG9saWN5'}]})});
    assert.equal(reply.ok,true);
    const parts=h.requests[1].body.contents.at(-1).parts;
    assert.equal(parts.filter(p=>p.inlineData).length,2);
    assert.equal(parts[0].functionResponse.response._attachFiles,undefined);
    assert.ok(parts.some(p=>p.text?.includes('Stored document: RC')));
    assert.equal(reply.calls[0].result._attachFiles,undefined,'large file bytes are not retained in tool history');
  }finally{h.cleanup();}
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

test('voice uses a native Tamil persona without contradictory text-chat restrictions',async()=>{
  for(const text of ['எது ரொம்ப விலை அதிகம்','enna panra','saptiya','Which update costs the most?','hello da']) {
    const h=harness(async()=>answer('Test response'));
    try {await h.AI.askSage(text,{voice:true,tools:false});
      const system=JSON.stringify(h.requests[0].body.systemInstruction);
      assert.match(system,/Answer what he actually asked first/);assert.match(system,/Do not keep adding da/);
      assert.doesNotMatch(system,/FINISH EVERY CLAUSE/);
      assert.doesNotMatch(system,/ENGLISH LETTERS ONLY|nouns.*verbs must stay ENGLISH|NEVER.*naan/i);
      assert.match(system,/Compose the answer directly/);
      assert.match(system,/familiar singular நீ/);assert.match(system,/Keep Viky in Latin letters/);
      assert.match(system,/^(?:Which|hello)/.test(text)?/He spoke English/:/natural spoken Tamil/);
    }finally{h.cleanup();}
  }
});
test('spoken moods never reintroduce text emojis or parked-bike status as a greeting',()=>{
  const h=harness(async()=>answer('ready'));
  try {for(const mood of Object.keys(h.AI.MOOD_DIRECTION)) {
    const voice=h.AI.personaFor(mood,'chat',{voice:true});
    assert.doesNotMatch(voice,/Emoji:|Afternoon, parked|Early morning, everything in you still cold/);
    assert.match(voice,/His name is spelled Viky/);
    assert.ok(h.AI.personaFor(mood,'chat').includes(h.AI.PERSONA),'ordinary text personality is preserved');
  }}finally{h.cleanup();}
});
test('closing a voice session during tool execution stops later tools and follow-up generation',async()=>{
  let cancelled=false;
  const h=harness(async()=>({ok:true,status:200,json:async()=>({candidates:[{content:{parts:[
    {functionCall:{name:'control_voice',args:{action:'close'}}},
    {functionCall:{name:'update_service',args:{id:4}}},
  ]},finishReason:'STOP'}]})}));
  try {const calls=[];const reply=await h.AI.converse({voice:true,history:[{role:'user',text:'End this call'}],
    isCancelled:()=>cancelled,onTool:async name=>{calls.push(name);cancelled=true;return {ok:true};}});
    assert.equal(reply.reason,'cancelled');assert.deepEqual(calls,['control_voice']);assert.equal(h.requests.length,1);
  }finally{h.cleanup();}
});

test('a model repeating an old close command cannot end a new hello turn',async()=>{
  const h=harness(async(url,init,n)=>n===1?{ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{functionCall:{name:'control_voice',args:{action:'close'}}}]},finishReason:'STOP'}]})}:answer('Hello!'));
  try {
    let closed=false;
    h.root.SageVoice={close(){closed=true;}};
    vm.runInNewContext(await readFile(new URL('../src/js/sage-tools.js',import.meta.url),'utf8'),h.root);
    const reply=await h.AI.askSage('hello',{voice:true,history:[{role:'user',text:'close voice mode'}]});
    assert.equal(reply.ok,true);assert.equal(closed,false);
    assert.equal(h.requests[0].body.tools[0].functionDeclarations.some(t=>t.name==='control_voice'),false);
    assert.equal(h.requests[1].body.contents.at(-1).parts[0].functionResponse.response.ok,false);
  }finally{h.cleanup();}
});

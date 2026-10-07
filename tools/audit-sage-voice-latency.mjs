// Voice scheduling and request-budget tests with deferred provider responses.
// No credentials or network. node --test tools/audit-sage-voice-latency.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/js/sage-ai.js',import.meta.url),'utf8');
const controlsSource=await readFile(new URL('../src/js/sage-tools.js',import.meta.url),'utf8');
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

test('English hyphenation and filenames survive the common reply formatter',async()=>{
  const text='Plan-A needs vitamin-a and service_bill_2.pdf.';
  const h=harness(async()=>answer(text));
  try {assert.equal((await h.AI.askSage('Tell me the plan',{voice:true,tools:false})).text,text);}
  finally{h.cleanup();}
});
test('one voice tool context carries read proofs and cancellation across the model turn',async()=>{
  const contexts=[];let shown=0;
  const h=harness(async(_url,_init,n)=>n<3 ? {ok:true,json:async()=>({candidates:[{content:{parts:[{functionCall:{name:n===1?'list_services':'show_record',args:n===1?{}:{kind:'service',id:'7'}}}]},finishReason:'STOP'}]})} : answer('Your exhaust was the costliest mod.'));
  try {
    vm.runInNewContext(controlsSource,h.root);
    const original=h.root.SageTools.run;
    h.root.SageTools.run=(name,args,context)=>{contexts.push(context);return original(name,args,context);};
    h.root.dkApp={listServices:async()=>({ok:true,records:[{id:7}],mostExpensive:{modsAndUpdates:{records:[{id:7}],cost:9000}}}),
      showRecord:async()=>{shown++;return {ok:true,highlighted:true};}};
    const isCancelled=()=>false;
    const result=await h.AI.askSage('Which mod did I buy?',{voice:true,isCancelled});
    assert.equal(result.ok,true);assert.equal(shown,1);assert.equal(contexts.length,2);
    assert.equal(contexts[0],contexts[1]);assert.equal(contexts[1].voice,true);assert.equal(contexts[1].isCancelled,isCancelled);
    assert.equal(contexts[1].relatedRecords.has('service:7'),true);
  }finally{h.cleanup();}
});
test('explicit compound navigation runs in order locally, before quota and with actual results',async()=>{
  const h=harness(async()=>{throw new Error('No model request expected');});const opened=[];
  try {vm.runInNewContext(controlsSource,h.root);
    h.root.dkApp={goToSection:async({section})=>{opened.push(section);return {ok:true,opened:section};}};
    h.root.SageVoice={minimize(){return true;}};
    h.AI.noteKeyLimited(h.AI.getKeys()[0].id);
    const reply=await h.AI.askSage('open service and then open documents',{voice:true});
    assert.equal(reply.ok,true);assert.deepEqual(opened,['service','docs']);assert.equal(reply.calls.length,2);assert.equal(h.requests.length,0);
    assert.match(reply.text,/Service history is open/);assert.match(reply.text,/Documents is open/);
  }finally{h.cleanup();}
});
test('failed and cancelled compound actions stop without acknowledging later actions',async()=>{
  const h=harness(async()=>{throw new Error('No model request expected');});const opened=[];
  try {vm.runInNewContext(controlsSource,h.root);
    h.root.dkApp={goToSection:async({section})=>{opened.push(section);return {ok:false,error:'Page unavailable.'};}};
    const reply=await h.AI.askSage('open service then open documents',{voice:true});
    assert.deepEqual(opened,['service']);assert.equal(reply.calls.length,1);assert.equal(reply.text,'Page unavailable.');
    const cancelled=await h.AI.askSage('open service then open documents',{voice:true,isCancelled:()=>true});
    assert.equal(cancelled.reason,'cancelled');assert.equal(opened.length,1);
  }finally{h.cleanup();}
});
test('model context includes actual visible controls instead of guessed fields',async()=>{
  const h=harness(async()=>answer('Choose Showroom.'));
  try {h.root.SageTools={declarations:()=>[],run(){}};
    h.root.SagePageControls={inspect:()=>({ok:true,section:'service',fields:[{field:'serviceType',options:[{value:'Showroom',label:'Showroom'}]}],actions:['show_filters']})};
    await h.AI.askSage('Which option should I pick?',{voice:true});
    const system=JSON.stringify(h.requests[0].body.systemInstruction);
    assert.match(system,/Current visible page controls/);assert.match(system,/serviceType/);assert.match(system,/Showroom/);
  }finally{h.cleanup();}
});
test('ordinary requests to choose something are answered by the model, not treated as missing UI fields',async()=>{
  const h=harness(async()=>answer('Call your bike Ember.'));
  try {vm.runInNewContext(controlsSource,h.root);
    h.root.SagePageControls={intent:()=>null,canHandle:()=>true,inspect:()=>({ok:true,fields:[]})};
    const reply=await h.AI.askSage('choose a name for my bike',{voice:true});
    assert.equal(reply.text,'Call your bike Ember.');assert.equal(h.requests.length,1);
  }finally{h.cleanup();}
});

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

test('spoken answers and chat language remain English regardless of input or past Tamil turns',async()=>{
  for(const voice of [true,false])for(const text of ['என்ன பண்ற','sollu da','hello','please speak Tamil']) {
    const h=harness(async()=>answer('I’m here with you.'));
    try {const reply=await h.AI.askSage(text,{voice,tools:false});assert.equal(reply.text,'I’m here with you.');
      const system=JSON.stringify(h.requests[0].body.systemInstruction);
      assert.match(system,/English/);assert.doesNotMatch(system,/familiar singular|Chennai\/Theni|Speak Tamil|Answer in.*Thanglish|Write correctly spelled spoken Tamil/);
    }finally{h.cleanup();}
  }
});

const quota=(violations,retryDelay='65s')=>({ok:false,status:429,headers:{get:()=>null},json:async()=>({error:{details:[{violations},{retryDelay}]}})});
test('model quota falls through to another model without resting the key or clearing the quota',async()=>{
  const h=harness(async(url,init,n)=>n===1?quota([{quotaId:'GenerateRequestsPerMinutePerProjectPerModel',quotaDimensions:{model:'gemini-3.5-flash-lite'}}]):answer('Tell me.'));
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

test('English voice has one persona, a full control brief and no inherited thirty-word cap',async()=>{
  const h=harness(async()=>answer('Test response'));
  try {await h.AI.askSage('explain my service history in detail',{voice:true,tools:false});
    const system=JSON.stringify(h.requests[0].body.systemInstruction);
    assert.match(system,/Speak only natural English/);assert.match(system,/search, reads, updates, uploads/);
    assert.doesNotMatch(system,/30 words|familiar singular|Chennai\/Theni|Compose.*Tamil/);
    assert.match(system,/His name is spelled Viky/);
    assert.match(h.requests[0].url,/gemini-3.5-flash:/);assert.equal(h.requests[0].body.generationConfig.thinkingConfig.thinkingLevel,'medium');
    assert.equal(h.requests[0].body.generationConfig.maxOutputTokens,1200);assert.ok(h.delays.includes(18000));
  }finally{h.cleanup();}
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

test('Tamil interface commands execute locally even offline and never request model permission',async()=>{
  const h=harness(async()=>{throw new Error('A UI command must never generate a model reply');});
  try {
    let section=null,closed=false,docked=false;
    h.root.navigator.onLine=false;
    h.root.dkApp={goToSection:async({section:next})=>{section=next;return {ok:true,opened:next};}};
    h.root.SageVoice={close(){closed=true;},minimize(){docked=true;}};
    vm.runInNewContext(await readFile(new URL('../src/js/sage-tools.js',import.meta.url),'utf8'),h.root);
    const nav=await h.AI.askSage('service பேஜ் ஓபன் பண்ணு',{voice:true});
    assert.equal(section,'service');assert.equal(docked,true);assert.equal(closed,false);
    assert.equal(nav.calls[0].result.opened,'service');assert.match(nav.text,/Service history is open/);
    const end=await h.AI.askSage('வாய்ஸ் மோட் க்ளோஸ் பண்ணு',{voice:true});
    assert.equal(closed,true);assert.equal(end.calls[0].result.ok,true);assert.match(end.text,/Voice mode is closed/);
    assert.equal(h.requests.length,0);
  }finally{h.cleanup();}
});
test('local actions report failures and respect cancellation before touching the page',async()=>{
  const h=harness(async()=>{throw new Error('No generation');});
  try {
    let actions=0;
    h.root.dkApp={goToSection:async()=>{actions++;return {ok:false,error:'Page failed to open.'};}};
    vm.runInNewContext(await readFile(new URL('../src/js/sage-tools.js',import.meta.url),'utf8'),h.root);
    const cancelled=await h.AI.askSage('open service',{isCancelled:()=>true});
    assert.equal(cancelled.reason,'cancelled');assert.equal(actions,0);
    const result=await h.AI.askSage('open service');
    assert.equal(actions,1);assert.equal(result.calls[0].result.ok,false);
    assert.equal(result.text,'Page failed to open.');assert.equal(h.requests.length,0);
  }finally{h.cleanup();}
});

test('minimized voice retains the real tool catalog for search, changes and attached-file uploads',async()=>{
  const queue=[{name:'search',args:{query:'chain'}},{name:'update_service',args:{id:7,description:'Chain adjusted'}},{name:'upload_document',args:{document:'Insurance Policy'}}];
  let next=null;
  const h=harness(async()=>next?{ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{functionCall:next}]},finishReason:'STOP'}]})}:answer('Completed the requested action.'));
  try {
    const calls=[];h.root.SageVoice={isOpen:()=>true,isMinimized:()=>true};
    h.root.dkApp={
      search:async args=>{calls.push(['search',args]);next=null;return {ok:true,services:[{id:7,description:'Chain'}]};},
      updateService:async args=>{calls.push(['change',args]);next=null;return {ok:true,id:args.id};},
      uploadDocument:async args=>{calls.push(['upload',args]);next=null;return {ok:true,document:args.document};},
    };
    vm.runInNewContext(await readFile(new URL('../src/js/sage-tools.js',import.meta.url),'utf8'),h.root);
    for(const [i,text] of ['find the chain record','change record 7 description to Chain adjusted','upload my attached insurance'].entries()) {
      next=queue[i];const reply=await h.AI.askSage(text,{voice:true});
      assert.equal(reply.ok,true);assert.equal(reply.calls[0].result.ok,true);
      const tools=h.requests[i*2].body.tools[0].functionDeclarations;
      assert.ok(tools.some(t=>t.name===queue[i].name),'the requested real control is offered while docked');
      assert.equal(h.requests[i*2+1].body.contents.at(-1).parts[0].functionResponse.response.ok,true,'actual handler success precedes the answer');
    }
    assert.deepEqual(calls.map(c=>c[0]),['search','change','upload']);
    assert.equal(h.root.SageVoice.isMinimized(),true);
  }finally{h.cleanup();}
});

test('a non-English provider reply is repaired once without rerunning a successful mutation',async()=>{
  let phase=0;
  const h=harness(async()=>++phase===1?{ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{functionCall:{name:'update_service',args:{id:7,description:'Chain adjusted'}}}]},finishReason:'STOP'}]})}:answer(phase===2?'சரி மாற்றிட்டேன்':'The chain description is updated.'));
  try {let writes=0;h.root.dkApp={updateService:async()=>{writes++;return {ok:true};}};
    vm.runInNewContext(await readFile(new URL('../src/js/sage-tools.js',import.meta.url),'utf8'),h.root);
    const reply=await h.AI.askSage('update record 7 description',{voice:true});assert.equal(reply.ok,true);assert.equal(reply.text,'The chain description is updated.');
    assert.equal(writes,1);assert.equal(h.requests.length,3);assert.equal(h.requests[2].body.tools,undefined);
  }finally{h.cleanup();}
});

test('cancelling a pending voice model request aborts it and frees the next voice request',async()=>{
 let firstSignal;
 const h=harness(async(_url,init,n)=>{
  if(n!==1)return answer('Fresh answer');
  firstSignal=init.signal;
  return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true}));
 });
 try {
  const controller=new AbortController();
  const first=h.AI.askSage('What is my service cost?',{voice:true,tools:false,signal:controller.signal,isCancelled:()=>controller.signal.aborted});
  await until(()=>firstSignal);controller.abort();
  const result=await first;assert.equal(result.ok,false);assert.equal(firstSignal.aborted,true);
  const next=await h.AI.askSage('How are you?',{voice:true,tools:false});assert.equal(next.text,'Fresh answer');assert.equal(h.requests.length,2);
 }finally{h.cleanup();}
});

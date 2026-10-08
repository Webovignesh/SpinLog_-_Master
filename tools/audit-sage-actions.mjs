// Generic fixtures exercising production controls, router, tools and AI routing.
// Provider responses are simulated. No account or stored user data is accessed.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
let chromium;
try {({chromium}=await import('playwright'));}
catch {({chromium}=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs'))));}
const app=await readFile(new URL('../src/js/script.js',import.meta.url),'utf8');
const sources=await Promise.all(['sage-page-controls','sage-tools','sage-ai'].map(name=>readFile(new URL(`../src/js/${name}.js`,import.meta.url),'utf8')));
const routerStart=app.indexOf("  const sections = document.querySelectorAll('main section');");
const routerEnd=app.indexOf('  window.dkNavigate = setActiveSection;',routerStart)+'  window.dkNavigate = setActiveSection;'.length;
function method(name,next) {
  const start=app.indexOf(`    async ${name}(`),end=app.indexOf(`    async ${next}(`,start);
  assert.ok(start>0&&end>start);return app.slice(start,end);
}
const fixture=`<style>body{margin:0}main section{display:none}main section.active{display:block;min-height:4000px}
.sl-modal-overlay{position:fixed;inset:0;background:white;z-index:50}[hidden],[aria-hidden="true"]{display:none!important}
.panel{height:180px;overflow:auto}.panel-content{height:1400px}.history-tools:not(.is-open){display:none}</style>
<main><section id="home" class="active"><h2>Home</h2><button id="genericButton">Sample button</button></section>
<section id="service"><h2>Service</h2><form id="serviceEntryForm"><label>Notes<textarea name="notes"></textarea></label>
<label>Cost<input name="cost" type="number" min="0"></label><button type="submit">Submit draft</button></form></section>
<section id="docs"><h2>Documents</h2><div class="vehicle-docs-grid"><div class="doc-card" data-type="Sample document">
<a class="doc-open-pill" href="https://example.invalid/sample.pdf">View document</a></div></div>
<button id="sampleFileButton" data-media-open="7" aria-label="Open sample-clip.mp4">File</button>
<a href="https://example.invalid/">External link</a>
<button id="docsHistoryNext">Next</button><div id="docsHistoryPages"><button aria-current="page">1</button></div></section>
<section id="sage"><h2>Chat</h2></section></main>
<div id="docAddModal" class="sl-modal-overlay" aria-hidden="true"><div class="panel" aria-label="Document fields"><div class="panel-content">
<label>Document name<input id="docAddName"></label><button id="docAddClose">Cancel draft</button></div></div></div>
<div id="docsPlayer" class="sl-modal-overlay" aria-hidden="true"><div class="panel"><div class="panel-content">Sample viewer</div></div></div>`;
let browser;
before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,args:['--no-sandbox','--disable-dev-shm-usage']});});
after(async()=>{await browser?.close();});
async function pageFor(t) {
  const page=await browser.newPage({viewport:{width:800,height:600}});t.after(()=>page.close());
  await page.route('**/*',r=>r.request().isNavigationRequest() ? r.fulfill({contentType:'text/html',body:fixture}) : r.abort());
  await page.goto('http://sage-controls.test');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
  await page.addScriptTag({content:`window.dkReduceMotion=()=>false;window.docks=0;
    window.SageVoice={minimize(){docks++;return true;},isOpen:()=>true,isMinimized:()=>true};
    window._historicMediaRows=new Map([[7,{id:7,media_type:'video',original_name:'sample-clip.mp4',upload_date:'2000-01-01'}]]);
    window._vehicleDocRows=new Map([['Sample document',{origName:'sample.pdf'}]]);
    async function ensureDocsLoaded(){};function getHistoricLocalNote(){return null;}
    (function(){function ensureSectionData(){};${app.slice(routerStart,routerEnd)}
    window.dkApp={${method('goToSection','showRecord')}${method('navigateHistory','prepareFileUpload')}
      ${method('listDocuments','listParkHistory')}};})();
    document.getElementById('docAddClose').onclick=()=>document.getElementById('docAddModal').setAttribute('aria-hidden','true');
    document.getElementById('docsHistoryNext').onclick=()=>document.querySelector('#docsHistoryPages button').textContent='2';
    window.opens=[];window.dkApp.openStoredFile=async args=>{opens.push(args);await new Promise(r=>setTimeout(r,60));
      if(window.failFile)return {ok:false,error:'Sample file is unavailable.'};
      document.getElementById('docsPlayer').setAttribute('aria-hidden','false');
      return {ok:true,opened:'file_viewer',name:args.kind==='document'?'sample.pdf':'sample-clip.mp4',playing:args.action==='play'};};
    window.dkApp.controlMediaPlayer=async({action})=>{if(action==='close')document.getElementById('docsPlayer').setAttribute('aria-hidden','true');
      return {ok:true,closed:action==='close',paused:action==='pause',playing:action==='play'};};
    document.getElementById('serviceEntryForm').onsubmit=e=>e.preventDefault();`});
  for(const content of sources)await page.addScriptTag({content});
  return page;
}
test('smooth repeated scrolls finish in order and each acknowledgement reflects movement',async t=>{
  const page=await pageFor(t);
  const result=await page.evaluate(async()=>{
    const replies=await Promise.all([SagePageControls.scroll({direction:'down'}),SagePageControls.scroll({direction:'down'})]);
    return {replies,y:scrollY};
  });
  assert.ok(result.replies.every(r=>r.ok&&r.verified&&r.moved));
  assert.ok(result.y>=820,JSON.stringify(result));assert.ok(result.replies[1].position.top>result.replies[0].position.top+400);
  const reply=await page.evaluate(()=>SageAI.askSage('scroll down two times',{voice:true}));
  assert.match(reply.text,/Scrolled down 2 times/);assert.equal(reply.calls[0].result.steps,2);
});
test('dialog scrolling targets the inner panel and leaves the page behind it alone',async t=>{
  const page=await pageFor(t);
  const result=await page.evaluate(async()=>{
    scrollTo(0,250);document.getElementById('docAddModal').setAttribute('aria-hidden','false');
    const targets=SagePageControls.inspect().scrollTargets;
    const first=await SagePageControls.scroll({direction:'down',count:2,target:targets[0].control});
    await SagePageControls.scroll({direction:'bottom'});
    const boundary=await SagePageControls.scroll({direction:'down'});
    return {first,boundary,pageTop:scrollY,panelTop:document.querySelector('#docAddModal .panel').scrollTop};
  });
  assert.equal(result.pageTop,250);assert.ok(result.panelTop>1000);assert.equal(result.first.surface,'docAddModal');
  assert.equal(result.boundary.moved,false,JSON.stringify(result));assert.equal(result.boundary.boundary,'bottom',JSON.stringify(result));
});
test('cancelling a scroll stops its motion and queued commands do not run on another page',async t=>{
  const page=await pageFor(t);
  const result=await page.evaluate(async()=>{
    let cancelled=false;setTimeout(()=>cancelled=true,50);
    const cancel=await SagePageControls.scroll({direction:'down',count:3},{isCancelled:()=>cancelled});
    const stopped=scrollY;await new Promise(r=>setTimeout(r,300));
    const stable=scrollY;
    const first=SagePageControls.scroll({direction:'bottom'});
    const stale=SagePageControls.scroll({direction:'down'});
    await dkApp.goToSection({section:'docs'});return {cancel,stopped,stable,first:await first,stale:await stale};
  });
  assert.equal(result.cancel.ok,false);assert.ok(Math.abs(result.stable-result.stopped)<2,JSON.stringify(result));
  assert.equal(result.stale.ok,false);assert.match(result.stale.error,/changed/);
});
test('an interrupted navigation never swaps pages or adds a history entry',async t=>{
  const page=await pageFor(t);
  const result=await page.evaluate(async()=>{
    let cancelled=false;setTimeout(()=>cancelled=true,30);
    const nav=await dkApp.goToSection({section:'docs',isCancelled:()=>cancelled});
    return {nav,section:SagePageControls.inspect().section,back:await dkApp.navigateHistory({direction:'back'}),leaving:!!document.querySelector('.is-leaving')};
  });
  assert.equal(result.nav.ok,false);assert.equal(result.section,'home');assert.equal(result.back.ok,false);assert.equal(result.leaving,false);
});
test('navigation refuses to obscure an open draft and closes a viewer before changing page',async t=>{
  const page=await pageFor(t);
  const result=await page.evaluate(async()=>{
    document.getElementById('docAddModal').setAttribute('aria-hidden','false');
    document.getElementById('docAddName').value='Synthetic draft';
    const blocked=await SageAI.askSage('open documents',{voice:true});
    const kept=document.getElementById('docAddName').value;
    const clear=await SageAI.askSage('close form then open documents',{voice:true});
    document.getElementById('docsPlayer').setAttribute('aria-hidden','false');
    const home=await SageAI.askSage('go to the main screen',{voice:true});
    return {blocked,kept,clear,home,page:SagePageControls.inspect()};
  });
  assert.match(result.blocked.text,/Close the current form/);assert.equal(result.kept,'Synthetic draft');
  assert.equal(result.clear.calls.length,2);assert.equal(result.home.calls[0].result.opened,'home');
  assert.equal(result.page.section,'home');assert.equal(result.page.dialog,null);
});
test('clicking a saved file awaits the viewer and an external document link uses the owned viewer',async t=>{
  const page=await pageFor(t);
  const result=await page.evaluate(async()=>{
    await dkApp.goToSection({section:'docs'});
    const inspected=SagePageControls.inspect(),file=inspected.controls.find(c=>c.label==='Open sample-clip.mp4');
    let finished=false;const pending=SagePageControls.click({control:file.control}).then(r=>{finished=true;return r;});
    await new Promise(r=>setTimeout(r,10));const early=finished;const opened=await pending;
    await dkApp.controlMediaPlayer({action:'close'});
    const document=SagePageControls.intent('click View document');const doc=await SagePageControls.click(document);
    return {early,opened,doc,externalListed:inspected.controls.some(c=>c.label==='External link'),opens:opens.map(({kind,id})=>({kind,id}))};
  });
  assert.equal(result.early,false);assert.equal(result.opened.outcome,'file_opened');assert.equal(result.doc.name,'sample.pdf');
  assert.equal(result.externalListed,false);assert.deepEqual(result.opens,[{kind:'media',id:'7'},{kind:'document',id:'Sample document'}]);
});
test('chains can open a page, play a named file, pause and return home without a model request',async t=>{
  const page=await pageFor(t);
  const result=await page.evaluate(()=>SageAI.askSage('open documents then play sample-clip.mp4 then pause video then go to home',{voice:true}));
  assert.match(result.text,/Playing sample-clip.mp4/);assert.match(result.text,/Paused/);assert.match(result.text,/Home is open/);
  assert.deepEqual(result.calls.map(c=>c.name),['navigate_section','list_media','open_stored_file','control_media_player','navigate_section']);
});
test('a failed file action stops the rest of its chain and reports the viewer error',async t=>{
  const page=await pageFor(t);await page.evaluate(()=>window.failFile=true);
  const result=await page.evaluate(()=>SageAI.askSage('open documents then play sample-clip.mp4 then go to home',{voice:true}));
  assert.match(result.text,/Sample file is unavailable/);assert.doesNotMatch(result.text,/Playing|Home is open/);
  assert.equal(result.calls.at(-1).result.ok,false);assert.equal(await page.evaluate(()=>SagePageControls.inspect().section),'docs');
});
test('an old named file is filtered before archive pagination and document names come from metadata',async t=>{
  const page=await pageFor(t);
  const result=await page.evaluate(async()=>{
    for(let i=100;i<180;i++)_historicMediaRows.set(i,{id:i,media_type:'video',original_name:`sample-${i}.mp4`,upload_date:'2026-01-01'});
    return {all:await dkApp.listMedia({limit:50}),named:await dkApp.listMedia({query:'SAMPLE-CLIP',limit:1}),docs:await dkApp.listDocuments()};
  });
  assert.equal(result.all.media.length,50);assert.equal(result.named.total,1);assert.equal(result.named.media[0].id,7);
  assert.equal(result.docs.documents[0].fileName,'sample.pdf');
});
test('form fills remain drafts and button presses do not claim persistence',async t=>{
  const page=await pageFor(t);
  const result=await page.evaluate(async()=>{
    await dkApp.goToSection({section:'service'});
    const fill=await SageAI.askSage('set notes to "Sample notes" then set cost to 45',{voice:true});
    const pressed=await SageAI.askSage('click Submit draft',{voice:true});
    return {fill,pressed,value:document.querySelector('[name="notes"]').value};
  });
  assert.equal(result.value,'Sample notes');assert.ok(result.fill.calls.every(c=>c.result.saved===false));
  assert.match(result.pressed.text,/Pressed Submit draft/);assert.equal(result.pressed.calls[0].result.saved,false);
});
test('stale controls and ineffective results-page buttons cannot produce success receipts',async t=>{
  const page=await pageFor(t);
  const result=await page.evaluate(async()=>{
    const old=SagePageControls.inspect().controls[0].control;await dkApp.goToSection({section:'docs'});
    const stale=await SagePageControls.click({control:old});const next=await SagePageControls.action({action:'next_results'});
    const unchanged=await SagePageControls.action({action:'next_results'});return {stale,next,unchanged};
  });
  assert.equal(result.stale.ok,false);assert.equal(result.next.ok,true);assert.equal(result.unchanged.ok,false);
});
test('UI completion text uses actual receipts even when the model supplies a false acknowledgement',async t=>{
  const page=await pageFor(t);
  const result=await page.evaluate(async()=>{
    SageAI.setKey('synthetic-test-key');
    fetch=async()=>({ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text:'Done, I clicked the missing button.'}]},finishReason:'STOP'}]})});
    return SageAI.askSage('click the missing button',{voice:true});
  });
  assert.equal(result.ok,true,JSON.stringify(result));assert.match(result.text,/hasn’t completed/);assert.doesNotMatch(result.text,/I clicked/);
});
test('receipts preserve factual answers and data writes while reporting failed UI or upload readiness truthfully',async t=>{
  const page=await pageFor(t);
  const result=await page.evaluate(()=>({
    fact:SageTools.actionReply('What is the highest cost entry?',[{name:'show_record',result:{ok:true,highlighted:true}}]),
    write:SageTools.actionReply('set the cover date',[{name:'update_cover',result:{ok:true}}]),
    failed:SageTools.actionReply('open something',[{name:'navigate_section',args:{section:'docs'},result:{ok:false,error:'Sample failure.'}}]),
    upload:SageTools.actionReply('open the upload form',[{name:'prepare_file_upload',result:{ok:true,uploaded:false}}]),
    edge:SageTools.actionReply('scroll down',[{name:'scroll_page',args:{direction:'down'},result:{ok:true,verified:true,moved:false,boundary:'bottom'}}]),
  }));
  assert.equal(result.fact,null);assert.equal(result.write,null);assert.equal(result.failed,'Sample failure.');
  assert.match(result.upload,/Choose the local file/);assert.equal(result.edge,'Already at the bottom.');
});
test('failed model-selected controls override a false completion and repeated receipts remain audible',async t=>{
  const page=await pageFor(t);
  const result=await page.evaluate(async()=>{
    SageAI.setKey('synthetic-test-key');let round=0;
    fetch=async()=>({ok:true,status:200,json:async()=>({candidates:[{content:{parts:round++===0?
      [{functionCall:{name:'scroll_page',args:{direction:'down',count:99}}}]:[{text:'Done, the page scrolled.'}]},finishReason:'STOP'}]})});
    const text='Use 1 to 8 scroll steps and small, page or large.';
    return SageAI.askSage('scroll down a few screens please',{voice:true,history:[{role:'model',parts:[{text}]}]});
  });
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.calls[0].result.ok,false);
  assert.match(result.text,/Use 1 to 8/);assert.doesNotMatch(result.text,/Done|page scrolled/);
});
test('a cancelled model turn never becomes a completion receipt',async t=>{
  const page=await pageFor(t);
  const result=await page.evaluate(async()=>{
    SageAI.setKey('synthetic-test-key');let cancelled=false;
    fetch=async()=>({ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{functionCall:{name:'scroll_page',args:{direction:'down'}}}]},finishReason:'STOP'}]})});
    return SageAI.askSage('scroll down a few screens please',{voice:true,isCancelled:()=>cancelled,onTool:()=>cancelled=true});
  });
  assert.equal(result.ok,false);assert.equal(result.reason,'cancelled');assert.equal(result.text,undefined);
});

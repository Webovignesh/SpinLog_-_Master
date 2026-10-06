// Actual voice DOM, audio capture, worklet, tools and local AI command routing.
// Chromium supplies the microphone; provider captions/TTS are simulated.
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
let chromium;
try {({chromium}=await import('playwright'));}
catch {({chromium}=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs'))));}
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),output='/tmp/sage-docked-preview';
const appSource=await readFile(path.join(root,'src/js/script.js'),'utf8');
const routerStart=appSource.indexOf("  const sections = document.querySelectorAll('main section');");
const routerEnd=appSource.indexOf('  window.dkNavigate = setActiveSection;',routerStart)+'  window.dkNavigate = setActiveSection;'.length;
const methodStart=appSource.indexOf('    async goToSection('),methodEnd=appSource.indexOf('    async saveParkLocation(',methodStart);
const backStart=appSource.indexOf('(function dkBackGuard()'),backEnd=appSource.indexOf('\n})();',backStart)+7;
const hashStart=appSource.indexOf("  window.addEventListener('hashchange', () => {"),hashEnd=appSource.indexOf('\n  });',hashStart)+6;
assert.ok(routerStart>=0 && methodStart>=0 && backStart>=0 && hashStart>=0,'production router/Back extracts exist');
const dateStart=appSource.indexOf('  function formatDateUIValue('),dateEnd=appSource.indexOf('  function getServiceEntryTypeControls()',dateStart);
const dropdownStart=dateEnd,dropdownEnd=appSource.indexOf('  // ── Cover badge helper',dropdownStart);
const modsStart=appSource.indexOf("  document.getElementById('serviceType')?.addEventListener('change'"),modsEnd=appSource.indexOf('  // Service entries store',modsStart);
assert.ok(dateStart>=0 && dropdownEnd>dropdownStart && modsEnd>modsStart);
const docStart=appSource.indexOf('function setupDocAddFlow()'),docEnd=appSource.indexOf('function describeExistingDocCard(',docStart);
const typesStart=appSource.indexOf('const VEHICLE_TYPES = ['),typesEnd=appSource.indexOf('];',typesStart)+2;
assert.ok(docStart>=0 && docEnd>docStart && typesStart>=0);
const routerSource=`(function(){function ensureSectionData(){}; ${appSource.slice(routerStart,routerEnd)}
  window.dkApp=({${appSource.slice(methodStart,methodEnd)}}); ${appSource.slice(hashStart,hashEnd)}
${appSource.slice(dateStart,dateEnd)} ${appSource.slice(dropdownStart,dropdownEnd)} ${appSource.slice(modsStart,modsEnd)}
  ${appSource.slice(typesStart,typesEnd)} ${appSource.slice(docStart,docEnd)}
  setupDateUI(); setupServiceEntryTypeDropdown(); setupDocAddFlow();
})(); ${appSource.slice(backStart,backEnd)}`;
await mkdir(output,{recursive:true});
const server=http.createServer(async(req,res)=>{
  if(req.url==='/audit-router.js'){res.setHeader('Content-Type','text/javascript');res.end(routerSource);return;}
  const rel=req.url.split('?')[0].replace(/^\/+/, '') || 'index.html',file=path.resolve(root,rel);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try {
    let data=await readFile(file);
    if(rel==='index.html')data=data.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>',
      ['date-picker','sage-page-controls','sage-tools','sage-ai','sage-transcription','sage-voice'].map(n=>`<script src="src/js/${n}.js?v=1.9.40"></script>`).join('')+'<script src="/audit-router.js"></script></body>');
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(data);
  }catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;let browser;
try {
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.addInitScript(()=>{
    window.ears=[];window.audioRequests=0;window.captureRequests=0;window.historyRows=[];window.selectedPage='sage';
    window.dkReduceMotion=()=>false;
    const media=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=(...args)=>{captureRequests++;return media(...args);};
    window.dkCloudStore={chatHistory:()=>historyRows.slice(),setChat:rows=>historyRows=rows};
    window.WebSocket=class {
      readyState=0;sent=[];
      constructor(){ears.push(this);setTimeout(()=>{this.readyState=1;this.onopen?.();},0);}
      send(raw){const m=JSON.parse(raw);this.sent.push(m);if(m.setup)this.message({setupComplete:{}});}
      message(m){this.onmessage?.({data:JSON.stringify(m)});}
      close(){this.readyState=3;}
    };
    const pcm=new Int16Array(2400);for(let i=0;i<pcm.length;i++)pcm[i]=Math.sin(i/6)*5000;
    const data=btoa(String.fromCharCode(...new Uint8Array(pcm.buffer)));
    window.fetch=async()=>{audioRequests++;return {ok:true,json:async()=>({candidates:[{content:{parts:[{inlineData:{data,mimeType:'audio/L16;rate=24000'}}]}}]})};};
  });
  for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844],['small',320,568]]) {
    await page.setViewportSize({width,height});await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.evaluate(()=>{
      const localAsk=SageAI.askSage;
      SageAI.availableKeys=()=>[{key:'test-only'}];
      SageAI.getKeys=SageAI.availableKeys;
      SageAI.askSage=(text,opts)=>(SageTools.uiPlan(text)||SageTools.uiIntent(text)||SagePageControls.intent(text))?localAsk(text,opts):Promise.resolve({ok:true,text:'I’m here. Keep talking.'});
      window.SageUI={open(){document.getElementById('testSettings').hidden=false;},isOpen(){return !document.getElementById('testSettings').hidden;}};
      const button=document.createElement('button');button.id='testPageButton';button.textContent='Page action';
      button.style.cssText='position:fixed;left:20px;top:120px;z-index:1100';button.onclick=()=>{window.pageClicked=true;};document.body.append(button);
      const settings=document.createElement('div');settings.id='testSettings';settings.hidden=true;
      settings.innerHTML='<input id="testSettingsInput" aria-label="Settings input">';
      settings.style.cssText='position:fixed;left:20px;top:180px;z-index:1100';document.body.append(settings);
      document.addEventListener('keydown',ev=>{if(ev.key==='Escape')settings.hidden=true;});
      dkApp.goToSection({section:'sage'});
    });
    await page.locator('#sageChatMic').click();
    await page.waitForFunction(()=>document.getElementById('sageVoiceState').textContent==='I’m listening');
    const initial=await page.evaluate(()=>({captures:captureRequests,setup:ears.length}));
    await page.evaluate(()=>SageVoice.sendVoiceText('service பேஜ் ஓபன் பண்ணு'));
    await page.waitForFunction(()=>SageVoice.isMinimized() && document.getElementById('sageVoiceState').textContent==='I’m listening');
    assert.equal(await page.evaluate(()=>document.querySelector('main section.active').id),'service');
    assert.equal(await page.evaluate(()=>location.hash),'#service');
    assert.equal(await page.locator('#sageVoiceOverlay').getAttribute('role'),'region');
    assert.equal(await page.locator('#sageVoiceOverlay').getAttribute('aria-modal'),'false');
    assert.equal(await page.locator('#sageVoiceOverlay').evaluate(el=>el.classList.contains('sl-modal--open')),false);
    assert.equal(await page.evaluate(()=>captureRequests),initial.captures,'navigation retains the same microphone');
    assert.equal(await page.evaluate(()=>dkBackGuardState.open),false,'the Back handler excludes docked controls');
    await page.goBack();await page.waitForFunction(()=>document.querySelector('main section.active').id==='sage');
    assert.equal(await page.evaluate(()=>SageVoice.isMinimized()),true,'page Back keeps the active call');
    await page.evaluate(()=>dkApp.goToSection({section:'service'}));
    await page.locator('#testPageButton').click();assert.equal(await page.evaluate(()=>pageClicked),true);
    await page.locator('#testPageButton').focus();await page.keyboard.press('Tab');
    assert.notEqual(await page.evaluate(()=>document.activeElement.id),'sageVoiceOrb','docked controls do not trap page focus');
    const before=await page.locator('#sageVoiceOverlay').boundingBox();
    const orb=await page.locator('#sageVoiceOrb').boundingBox();
    const counts=await page.evaluate(()=>({audio:audioRequests,turns:historyRows.length,captures:captureRequests}));
    await page.mouse.move(orb.x+orb.width/2,orb.y+orb.height/2);await page.mouse.down();
    await page.mouse.move(35,70,{steps:10});await page.mouse.up();
    const moved=await page.locator('#sageVoiceOverlay').boundingBox();
    assert.ok(Math.hypot(before.x-moved.x,before.y-moved.y)>50,'orb drags to another corner');
    assert.ok(moved.x>=12 && moved.y>=12 && moved.x+moved.width<=width-11 && moved.y+moved.height<=height-11,'drag clamps the whole control into view');
    assert.deepEqual(await page.evaluate(()=>({audio:audioRequests,turns:historyRows.length,captures:captureRequests})),counts,'drag never submits speech or restarts audio');
    await page.locator('#sageVoiceOrb').focus();await page.keyboard.press('ArrowRight');
    assert.ok((await page.locator('#sageVoiceOverlay').boundingBox()).x>moved.x,'keyboard movement works');
    assert.ok(Math.abs(moved.width-144)<1 && Math.abs(moved.height-172)<1,'larger minimized orb and mode pill stay within the viewport');
    assert.equal(await page.locator('#sageVoiceOverlay button:visible').count(),1,'there is no minimized panel or extra control');
    assert.equal(await page.locator('#sageVoiceState').isVisible(),true,'mode pill is visible');
    assert.equal(await page.locator('#sageVoiceState').textContent(),'I’m listening');
    assert.equal(await page.locator('#sageVoiceOverlay').evaluate(el=>getComputedStyle(el).backdropFilter),'none','the dock does not blur the page');
    assert.equal(Math.round((await page.locator('#sageVoiceOrb').boundingBox()).width),136);
    for(const id of ['sageVoiceLines','sageVoiceEnd','sageVoiceCaption']) assert.equal(await page.locator('#'+id).isVisible(),false,id);
    await page.screenshot({path:path.join(output,`${name}-docked.png`)});
    await page.waitForTimeout(410);
    await page.locator('#sageVoiceOrb').click();assert.equal(await page.evaluate(()=>SageVoice.isMinimized()),false);
    assert.equal(await page.locator('#sageVoiceOverlay').getAttribute('aria-modal'),'true');
    assert.equal(await page.evaluate(()=>captureRequests),initial.captures,'expansion never reacquires microphone');
    await page.locator('#sageVoiceWindow').click();assert.equal(await page.evaluate(()=>SageVoice.isMinimized()),true);
    await page.evaluate(()=>SageVoice.sendVoiceText('expand voice mode'));
    assert.equal(await page.evaluate(()=>SageVoice.isMinimized()),false);
    await page.evaluate(()=>SageVoice.sendVoiceText('மினிமைஸ் பண்ணு'));
    await page.waitForFunction(()=>SageVoice.isMinimized() && document.getElementById('sageVoiceState').textContent==='I’m listening');
    await page.evaluate(()=>SageVoice.sendVoiceText('open service form'));
    assert.equal(await page.evaluate(()=>document.querySelector('main section.active').id),'service');
    const compound=await page.evaluate(()=>SageAI.askSage('open service form and select Showroom and set cost to 450 then set notes to "do not forget service_bill_2.pdf"',{voice:true}));
    assert.equal(compound.calls.length,4);assert.ok(compound.calls.every(call=>call.result.ok));
    assert.equal(await page.locator('#serviceType').inputValue(),'Showroom');
    assert.equal(await page.locator('#serviceEntryForm [name="cost"]').inputValue(),'450');
    assert.equal(await page.locator('#serviceEntryForm [name="notes"]').inputValue(),'do not forget service_bill_2.pdf');
    assert.equal(await page.evaluate(()=>SageTools.uiPlan('open service form and choose a name for my bike')),null,'an unknown generative request stays with the model');
    assert.equal(await page.evaluate(()=>captureRequests),initial.captures,'compound draft retains the active mic');
    const formState=await page.evaluate(()=>SageTools.run('inspect_page_controls',{}));
    assert.ok(formState.fields.find(f=>f.field==='serviceType').options.some(o=>o.value==='Showroom'));
    assert.equal(formState.fields.some(f=>/sageKey|sageVault|sageChat|fileInput/.test(f.field)),false,'credentials and attachment selection are never exposed');
    await page.evaluate(()=>SageVoice.sendVoiceText('select Showroom'));
    assert.equal(await page.locator('#serviceType').inputValue(),'Showroom');
    assert.equal(await page.locator('#serviceTypeValue').textContent(),'Showroom','real custom dropdown display follows its selection');
    assert.equal(await page.locator('#serviceTypeMenu [data-value="Showroom"]').getAttribute('aria-selected'),'true');
    await page.evaluate(()=>SageVoice.sendVoiceText('set odometer to 6500'));
    assert.equal(await page.locator('#serviceEntryForm [name="odo"]').inputValue(),'6500');
    const drafted=await page.evaluate(()=>SageTools.run('fill_page_fields',{fields:[{field:'serviceEntryForm.date',value:'2026-10-06'},{field:'serviceEntryForm.cost',value:'500'}]},{userText:'fill the date and cost'}));
    assert.equal(drafted.ok,true);assert.equal(drafted.saved,false);
    assert.equal(await page.locator('#serviceEntryForm [name="date"]').inputValue(),'2026-10-06');
    assert.match(await page.locator('#serviceEntryForm [name="date"]').evaluate(el=>el.closest('.date-shell').querySelector('.date-display').textContent),/06 Oct 2026/);
    const invalid=await page.evaluate(()=>SageTools.run('fill_page_fields',{fields:[{field:'serviceEntryForm.cost',value:'700'},{field:'serviceType',value:'Invented option'}]},{userText:'fill the form'}));
    assert.equal(invalid.ok,false);assert.equal(await page.locator('#serviceEntryForm [name="cost"]').inputValue(),'500','invalid batches are prevalidated before any edit');
    const secret=await page.evaluate(()=>SageTools.run('fill_page_fields',{fields:[{field:'sageKeyInput',value:'secret'}]},{userText:'fill the field'}));
    assert.equal(secret.ok,false);
    await page.evaluate(()=>{const pager=document.getElementById('serviceHistoryPager');pager.hidden=false;document.getElementById('serviceHistoryPerPage').addEventListener('change',()=>{window.perPageChanged=true;});});
    const nativeSelect=await page.evaluate(()=>SageTools.run('fill_page_fields',{fields:[{field:'serviceHistoryPerPage',value:'25'}]},{userText:'select 25 rows per page'}));
    assert.equal(nativeSelect.ok,true);assert.equal(await page.locator('#serviceHistoryPerPage').inputValue(),'25');
    assert.equal(await page.evaluate(()=>window.perPageChanged),true,'native selections emit the change event');
    await page.evaluate(()=>SageVoice.sendVoiceText('select Mods/Updates'));
    assert.equal(await page.locator('#nextDueLabel').isVisible(),false,'selection runs the production dependent-field handler');
    const hidden=await page.evaluate(()=>SageTools.run('fill_page_fields',{fields:[{field:'serviceEntryForm.nextDue',value:'2026-11-06'}]},{userText:'fill next due date'}));
    assert.equal(hidden.ok,false,'Sage cannot fill a field hidden by the chosen service type');
    await page.evaluate(()=>SageVoice.sendVoiceText("It's not a main screen, go to main page."));
    assert.equal(await page.evaluate(()=>document.querySelector('main section.active').id),'home');
    assert.equal(await page.evaluate(()=>SageVoice.isMinimized()),true);
    assert.equal(await page.evaluate(()=>captureRequests),initial.captures,'form commands preserve the same microphone');
    await page.evaluate(()=>SageVoice.sendVoiceText('open documents'));
    await page.evaluate(()=>SageVoice.sendVoiceText('go back'));
    assert.equal(await page.evaluate(()=>document.querySelector('main section.active').id),'home');
    await page.evaluate(()=>SageVoice.sendVoiceText('next page'));
    assert.equal(await page.evaluate(()=>document.querySelector('main section.active').id),'docs');
    const prep=await page.evaluate(()=>SageTools.run('prepare_file_upload',{kind:'image'},{userText:'upload a photo'}));
    assert.equal(prep.ok,true);assert.equal(prep.uploaded,false);
    await page.locator('#sageVoiceOrb').click();
    const pickerPromise=page.waitForEvent('filechooser');await page.locator('#sageVoiceChooseFile').click();
    const picker=await pickerPromise;assert.equal(await picker.element().getAttribute('accept'),'.jpg,.jpeg,.png,.webp');
    await picker.setFiles([]);
    assert.equal(await page.evaluate(()=>SageVoice.isMinimized()),true);
    assert.equal(await page.locator('#sageVoiceChooseFile').isVisible(),false);
    assert.equal(await page.evaluate(()=>captureRequests),initial.captures,'file preparation keeps the microphone');
    await page.evaluate(()=>SageVoice.sendVoiceText('open document form'));
    assert.equal(await page.locator('#docAddModal').getAttribute('aria-hidden'),'false','production document flow is open');
    const docFields=await page.evaluate(()=>SageTools.run('inspect_page_controls',{}));
    assert.deepEqual(docFields.fields.map(f=>f.field),['docAddName','docAddNotes'],'only the active modal fields are exposed');
    const docDraft=await page.evaluate(()=>SageTools.run('fill_page_fields',{fields:[{field:'docAddName',value:'Trip permit'},{field:'docAddNotes',value:'Ready for the ride'}]},{userText:'fill the document details'}));
    assert.equal(docDraft.ok,true);assert.equal(docDraft.saved,false);
    assert.equal(await page.locator('#docAddName').inputValue(),'Trip permit');
    const blocked=await page.evaluate(()=>SageTools.run('activate_page_control',{action:'open_search'},{userText:'open search'}));
    assert.equal(blocked.ok,false,'search cannot navigate behind an open document dialog');
    assert.equal(await page.locator('#docAddModal').getAttribute('aria-hidden'),'false');
    await page.evaluate(()=>SageVoice.sendVoiceText('close form'));
    assert.equal(await page.locator('#docAddModal').getAttribute('aria-hidden'),'true');
    assert.equal(await page.evaluate(()=>SageVoice.isOpen()),true,'closing a draft is independent of closing the call');
    await page.evaluate(()=>SageVoice.sendVoiceText('open search'));
    assert.equal(await page.evaluate(()=>document.querySelector('main section.active').id),'sage','search opens its actual owning section');
    assert.equal(await page.locator('#dkSearchInput').isVisible(),true);
    const hiddenField=await page.evaluate(()=>{
      const input=document.getElementById('dkSearchInput');input.style.visibility='hidden';
      const result=SagePageControls.fill({fields:[{field:'dkSearchInput',value:'hidden edit'}]});input.style.visibility='';return result;
    });
    assert.equal(hiddenField.ok,false,'CSS-hidden fields are unavailable');
    const confirmation=await page.evaluate(()=>{
      const modal=document.createElement('div');modal.className='sl-slide-overlay';modal.style.cssText='position:fixed;inset:0;z-index:9999';document.body.append(modal);
      const state=SagePageControls.inspect(),result=SagePageControls.fill({fields:[{field:'dkSearchInput',value:'behind confirmation'}]});modal.remove();return {state,result};
    });
    assert.equal(confirmation.state.fields.length,0);assert.equal(confirmation.result.ok,false,'confirmation dialogs block underlying fields');
    await page.evaluate(()=>SageVoice.sendVoiceText('open voice settings'));
    await page.locator('#testSettingsInput').fill('Website remains interactive');
    await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>SageVoice.isOpen()),true,'Escape belongs to settings while docked');
    for(let i=0;i<5;i++)await page.evaluate(i=>SageVoice.sendVoiceText(`Turn ${i}: சொல்லு டா`),i);
    assert.equal(await page.evaluate(()=>SageVoice.isMinimized()),true);
    assert.equal(await page.evaluate(()=>captureRequests),initial.captures,'six replies keep the same live microphone');
    await page.waitForFunction(()=>document.getElementById('sageVoiceState').textContent==='I’m listening');
    await page.setViewportSize({width:320,height:420});
    const resized=await page.locator('#sageVoiceOverlay').boundingBox();
    assert.ok(resized.x>=12 && resized.y>=12 && resized.x+resized.width<=309 && resized.y+resized.height<=409,'resizing keeps the orb in view');
    const frames=await page.evaluate(async()=>{
      const samples=[];const overlay=document.getElementById('sageVoiceOverlay');
      SageVoice.sendVoiceText('வாய்ஸ் மோட் க்ளோஸ் பண்ணு');
      for(let i=0;i<12;i++){await new Promise(requestAnimationFrame);samples.push({display:getComputedStyle(overlay).display,width:overlay.getBoundingClientRect().width});}
      return samples;
    });
    assert.ok(frames.every(f=>f.display==='none'),'closing compact controls never paints a full-screen flash');
    assert.equal(await page.evaluate(()=>SageVoice.isOpen()),false);
    assert.equal(await page.evaluate(()=>ears.every(ws=>ws.readyState===3)),true,'close releases all Live sockets');
    await page.waitForFunction(()=>document.getElementById('sageVoiceOverlay').hidden);
    console.log(`✓ ${name}: real router/Back, Tamil route/close, continuing call, drag/tap separation, keyboard, page/settings access, larger orb/status pill, real custom/native dropdowns and calendar fields, document draft/close, local Home correction, spoken minimize/expand, Back/Next, upload picker and repeated replies, flash-free close and resize bounds`);
  }
  assert.deepEqual(errors,[]);console.log('✓ No page errors; provider speech quality is outside this simulated transport audit');
}finally {await browser?.close();await new Promise(r=>server.close(r));}

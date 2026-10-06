// Real tool handlers and app methods in isolated contexts; no credentials or writes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const toolsSource=await readFile(new URL('../src/js/sage-tools.js',import.meta.url),'utf8');
const appSource=await readFile(new URL('../src/js/script.js',import.meta.url),'utf8');
function appMethod(name,next,context) {
  const start=appSource.indexOf(`    async ${name}(`),end=appSource.indexOf(`    async ${next}(`,start);
  assert.ok(start>=0&&end>start);return vm.runInNewContext(`({${appSource.slice(start,end)}})`,context)[name];
}
function harness(overrides={}) {
  let open=true,section=null,tab=null,docked=false;
  const root={console:{log(){},warn(){}},
    SageVoice:{open(){open=true;return true;},close(){open=false;},minimize(){if(!open)return false;docked=true;return true;},expand(){if(!open)return false;docked=false;return true;},},
    SageUI:{open(t){tab=t;},isOpen:()=>!!tab},...overrides};
  root.self=root;vm.runInNewContext(toolsSource,root);
  root.dkApp={goToSection:appMethod('goToSection','saveParkLocation',{setActiveSection:s=>{section=s;},document:{querySelector:()=>({id:section})}}),
    openSection:appMethod('openSection','goToSection',{})};
  return {root,run:root.SageTools.run,get open(){return open;},get section(){return section;},get tab(){return tab;},get docked(){return docked;}};
}
test('explicit navigation opens the page and docks the continuing call; an offer never navigates',async()=>{
  const h=harness();assert.equal((await h.run('open_section',{section:'service'})).offered,'service');
  assert.equal(h.section,null);assert.equal(h.open,true);
  assert.equal((await h.run('navigate_section',{section:'docs',highlight:'untrusted selector'},{userText:'open documents'})).opened,'docs');
  assert.equal(h.section,'docs');assert.equal(h.open,true);assert.equal(h.docked,true);
});
test('unknown destinations and failed navigation leave the call intact',async()=>{
  const h=harness();assert.equal((await h.run('navigate_section',{section:'javascript:alert(1)'})).ok,false);
  assert.equal(h.open,true);assert.equal(h.section,null);
  h.root.dkApp.goToSection=async()=>({ok:false,error:'Unavailable'});
  assert.equal((await h.run('navigate_section',{section:'docs'},{userText:'open documents'})).ok,false);assert.equal(h.open,true);
});
test('navigation waits for the actual section swap and cancellation is not reported as opened',async()=>{
  let finish;
  const method=appMethod('goToSection','saveParkLocation',{document:{querySelector:()=>({id:'docs'})},setActiveSection:()=>new Promise(resolve=>{finish=resolve;})});
  let finished=false;const action=method({section:'service'}).then(result=>{finished=true;return result;});
  await Promise.resolve();assert.equal(finished,false);finish(false);
  assert.equal((await action).ok,false);
  const result=method({section:'docs'});finish(true);assert.equal((await result).opened,'docs');
});
test('voice and settings work before data loads, and only accept whitelisted controls',async()=>{
  const h=harness();delete h.root.dkApp;
  assert.equal((await h.run('control_voice',{action:'delete'})).ok,false);assert.equal(h.open,true);
  assert.equal((await h.run('control_voice',{action:'close'},{userText:'close voice mode'})).ok,true);assert.equal(h.open,false);
  assert.equal((await h.run('control_voice',{action:'open'},{userText:'open voice mode'})).ok,true);assert.equal(h.open,true);
  assert.equal((await h.run('open_sage_settings',{tab:'voice'},{userText:'open voice settings'})).ok,true);assert.equal(h.tab,'voice');assert.equal(h.open,true);assert.equal(h.docked,true);
  assert.equal((await h.run('open_sage_settings',{tab:'anything'})).ok,false);
});
function services(rows) {
  return appMethod('listServices','getCover',{serviceEntries:rows,okISO:s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)});
}
test('costliest update spans every record, preserves ties and stays separate from total spending',async()=>{
  const rows=Array.from({length:55},(_,i)=>({id:i,date:'2026-10-01',type:'Mods/Updates',cost:100,notes:'Small update'}));
  rows.push({id:90,date:'2020-01-01',type:'Mods/Updates',cost:'9000',notes:'Exhaust'},
    {id:91,date:'2021-01-01',type:'Mods/Updates',cost:9000,notes:'Suspension'},
    {id:92,date:'2022-01-01',type:'Showroom',cost:12000,notes:'Engine repair'});
  const list=services(rows),result=await list({limit:1});
  assert.equal(result.truncated,true);assert.equal(result.records[0].id,0);
  assert.equal(result.totals.everything,35500);assert.equal(result.mostExpensive.everything.cost,12000);
  assert.equal(result.mostExpensive.modsAndUpdates.cost,9000);
  assert.deepEqual(Array.from(result.mostExpensive.modsAndUpdates.records,r=>r.id),[91,90]);
  const ranked=await list({sort:'cost_desc',type:'Mods/Updates',limit:1});assert.equal(ranked.records[0].id,91);
  const filtered=await list({from:'2026-01-01'});assert.equal(filtered.mostExpensive.modsAndUpdates.cost,100);
  assert.equal(rows[0].id,0,'sorting does not mutate app records');
});
test('missing prices do not become invented zero-cost winners; empty filters have no maximum',async()=>{
  const list=services([{id:1,date:'2026-01-01',type:'Mods/Updates',cost:null},
    {id:2,date:'2026-01-01',type:'Mods/Updates',cost:'unknown'}]);
  assert.equal((await list()).mostExpensive.everything,null);
  const empty=await list({type:'Showroom'});assert.equal(empty.total,0);assert.equal(empty.mostExpensive.modsAndUpdates,null);
});

test('hello and historical/negated command mentions cannot dismiss the call through any UI tool',async()=>{
  for(const text of ['hello','hi Sage','வணக்கம்','hello, how are you',"don't close voice mode",'how do I close voice mode','earlier I said close voice mode','say close voice mode','why did you open documents']) {
    const h=harness(),context={userText:text};
    for(const [name,args] of [['control_voice',{action:'close'}],['navigate_section',{section:'home'}],['open_sage_settings',{tab:'voice'}]]) {
      assert.equal((await h.run(name,args,context)).ok,false,text);
      assert.equal(h.root.SageTools.declarations(context).some(t=>t.name===name),false);
    }
    assert.equal(h.open,true);assert.equal(h.section,null);assert.equal(h.tab,null);
  }
});
test('explicit commands authorize only the current action and destination, including Tamil and Tanglish',async()=>{
  const h=harness();
  assert.equal((await h.run('control_voice',{action:'close'},{userText:'open voice mode'})).ok,false);
  assert.equal((await h.run('navigate_section',{section:'home'},{userText:'open documents'})).ok,false);
  for(const text of ['close voice mode','close voice','voice mode close pannu','வாய்ஸ் மோடை மூடு']) {
    assert.equal((await h.run('control_voice',{action:'close'},{userText:text})).ok,true);
  }
});

test('reading all documents paginates real attachments, skips missing papers and reports failed files',async()=>{
  const h=harness();const opened=[];
  h.root.dkApp.listDocuments=async()=>({ok:true,documents:['RC','Insurance','PUC','Licence','Extra'].map(document=>({document,onFile:document!=='PUC'}))});
  h.root.dkApp.readDocument=async({document})=>{opened.push(document);return document==='Insurance'?{ok:false,error:'Unavailable'}:{ok:true,fileName:document+'.pdf',_attachFile:{mimeType:'application/pdf',data:'ZmlsZQ=='}};};
  const first=await h.run('read_documents',{offset:0,limit:3});
  assert.deepEqual(opened,['RC','Insurance','Licence']);assert.equal(first.total,4);assert.equal(first.nextOffset,3);assert.equal(first.complete,false);
  assert.equal(first._attachFiles.length,2);assert.equal(first.documents[1].read,false);assert.match(first.documents[1].error,/Unavailable/);
  const last=await h.run('read_documents',{offset:first.nextOffset});assert.equal(last.complete,true);assert.equal(last._attachFiles[0].name,'Extra');
});
test('document batches cap attachments without claiming unread oversized files were read',async()=>{
  const h=harness();h.root.dkApp.listDocuments=async()=>({ok:true,documents:[{document:'Large policy',onFile:true}]});
  h.root.dkApp.readDocument=async()=>({ok:true,_attachFile:{mimeType:'application/pdf',data:'a'.repeat(15*1024*1024)}});
  const result=await h.run('read_documents',{});assert.equal(result._attachFiles.length,0);assert.equal(result.documents[0].read,false);assert.match(result.documents[0].error,/read_document/);
});
test('capabilities describe actual controls before data loads and preserve explicit UI guards',async()=>{
  const h=harness();delete h.root.dkApp;const result=await h.run('get_app_capabilities',{});
  assert.equal(result.ok,true);assert.ok(result.controls.some(c=>c.name==='read_documents'));assert.ok(result.controls.some(c=>c.name==='control_voice'));
  assert.equal((await h.run('control_voice',{action:'close'},{userText:'what can you do'})).ok,false);
});

test('polite requests normalize whitespace without weakening negation protection',async()=>{
  const h=harness();
  assert.equal((await h.run('navigate_section',{section:'docs'},{userText:'Sage, could you please open   the documents page?'})).ok,true);
  assert.equal((await h.run('control_voice',{action:'close'},{userText:'Please do not close voice mode'})).ok,false);
});

test('the screenshot Tamil and mixed-script requests execute actual controls',async()=>{
  for(const text of ['service பேஜ் ஓபன் பண்ணு','சர்வீஸ் பேஜ் ஓபன் பண்ணுங்க','சர்வீஸ் பக்கத்தை திற','service page open pannu']) {
    const h=harness(),intent=h.root.SageTools.uiIntent(text);
    assert.equal(intent?.section,'service',text);
    const result=await h.run(intent.name,{section:intent.section},{userText:text});
    assert.equal(result.ok,true);assert.equal(h.section,'service');assert.equal(h.open,true);assert.equal(h.docked,true);
  }
  for(const text of ['வாய்ஸ் மோட் க்ளோஸ் பண்ணு','வாய்ஸ் மோடை குளோஸ் பண்ணுங்க','வாய்ஸ் மோடு மூடு','voice mode close pannu','கால் கட் பண்ணு']) {
    const h=harness(),intent=h.root.SageTools.uiIntent(text);
    assert.equal(intent?.action,'close',text);
    assert.equal((await h.run(intent.name,{action:intent.action},{userText:text})).ok,true);assert.equal(h.open,false);
  }
});
test('Tamil negations, questions, greetings and unknown pages cannot perform controls',async()=>{
  const h=harness();
  for(const text of ['வாய்ஸ் மோட் க்ளோஸ் பண்ணாத','வாய்ஸ் மோடை மூடாத','சர்வீஸ் பேஜ் ஓபன் பண்ண வேண்டாம்','வாய்ஸ் மோடை எப்படி மூடுவது','முன்னாடி வாய்ஸ் மோட் க்ளோஸ் பண்ணு சொன்னேன்','அண்ணே','open nonexistent page']) {
    assert.equal(h.root.SageTools.uiIntent(text),null,text);
  }
  assert.equal(h.open,true);assert.equal(h.section,null);
});
test('a failed action never gets a success acknowledgement or minimizes the call',async()=>{
  const h=harness();h.root.dkApp.goToSection=async()=>({ok:false,error:'Page is unavailable.'});
  const raw='service பேஜ் ஓபன் பண்ணு',intent=h.root.SageTools.uiIntent(raw);
  const result=await h.run(intent.name,{section:intent.section},{userText:raw});
  assert.equal(h.docked,false);assert.doesNotMatch(h.root.SageTools.uiReply(intent,result,raw),/திறந்திருக்கு|opened/);
});

test('spoken minimize/restore uses the shared intent guard and keeps the call open',async()=>{
  const h=harness();
  for(const text of ['minimize yourself','minimize voice mode','voice mode minimize pannu','மினிமைஸ் பண்ணு','வாய்ஸ் மோடை மினிமைஸ் பண்ணு','ஓரமா போ']) {
    const intent=h.root.SageTools.uiIntent(text);assert.equal(intent?.action,'minimize',text);
    assert.equal((await h.run(intent.name,{action:intent.action},{userText:text})).ok,true);assert.equal(h.open,true);assert.equal(h.docked,true);
  }
  assert.equal((await h.run('control_voice',{action:'expand'},{userText:'expand voice mode'})).ok,true);assert.equal(h.docked,false);
  for(const text of ["don't minimize yourself",'மினிமைஸ் பண்ணாத','how do I minimize voice mode','hello']) assert.equal(h.root.SageTools.uiIntent(text),null,text);
});
test('back/next requires the current request and reports actual in-app navigation',async()=>{
  const h=harness();h.root.dkApp.navigateHistory=async({direction})=>direction==='back'?{ok:true,opened:'home'}:{ok:false,error:'No next page'};
  for(const text of ['back','go back','previous page','பின்னாடி போ','back po']) {
    assert.equal(h.root.SageTools.uiIntent(text)?.direction,'back',text);
    assert.equal((await h.run('navigate_history',{direction:'back'},{userText:text})).ok,true);
  }
  assert.equal((await h.run('navigate_history',{direction:'forward'},{userText:'next page'})).ok,false);
  for(const text of ['next page','முன்னாடி போ','அடுத்த பக்கத்துக்கு போ']) assert.equal(h.root.SageTools.uiIntent(text)?.direction,'forward',text);
  assert.equal((await h.run('navigate_history',{direction:'back'},{userText:'hello'})).ok,false);
});
test('file picker preparation requires an upload request and never claims a completed upload',async()=>{
  const h=harness();h.root.dkApp.prepareFileUpload=async({kind})=>({ok:true,ready:kind,uploaded:false});
  assert.equal((await h.run('prepare_file_upload',{kind:'image'},{userText:'upload a photo'})).uploaded,false);
  for(const text of ['hello','choose a different color','how do I upload a file',"don't upload anything",'அப்லோட் பண்ணாத']) assert.equal((await h.run('prepare_file_upload',{kind:'image'},{userText:text})).ok,false,text);
});

test('in-app Back/Next stops at session boundaries and cancels without losing its position',async()=>{
  const trail=['home','service','docs'];let allow=true;const routed=[];
  let active='docs';
  const context={sectionTrail:trail,sectionTrailIndex:2,document:{querySelector:()=>({id:active})},setActiveSection:async(section,mode)=>{routed.push({section,mode});if(allow)active=section;return allow;}};
  const navigate=appMethod('navigateHistory','prepareFileUpload',context);
  assert.equal((await navigate({direction:'forward'})).ok,false);assert.equal(routed.length,0);
  allow=false;assert.equal((await navigate({direction:'back'})).ok,false);assert.equal(context.sectionTrailIndex,2);
  allow=true;assert.equal((await navigate({direction:'back'})).opened,'service');assert.equal(context.sectionTrailIndex,1);
  assert.equal((await navigate({direction:'back'})).opened,'home');assert.equal((await navigate({direction:'back'})).ok,false);
  assert.equal((await navigate({direction:'forward'})).opened,'service');assert.equal(routed.at(-1).mode,'trail');
});

test('main screen/page aliases and a correction route to actual Home',async()=>{
  for(const text of ['go to main screen','go to the main page','open the home screen',"It's not a main screen, go to main page."]) {
    const h=harness(),intent=h.root.SageTools.uiIntent(text);
    assert.equal(intent.section,'home',text);
    const result=await h.run(intent.name,{section:intent.section},{userText:text});
    assert.equal(result.opened,'home');assert.equal(h.section,'home');assert.equal(h.docked,true);
  }
});
test('router success without a real page swap cannot produce a navigation acknowledgement',async()=>{
  const method=appMethod('goToSection','saveParkLocation',{setActiveSection:async()=>true,document:{querySelector:()=>({id:'sage'})}});
  const result=await method({section:'home'});assert.equal(result.ok,false);assert.match(result.error,/did not become active/);
});
test('form controls reject greetings, negated edits, explanations and historical instructions',async()=>{
  let writes=0;const h=harness({SagePageControls:{fill(){writes++;return {ok:true};}}});
  for(const text of ['hello',"don't fill the cost",'how do I select Showroom','what can you fill','earlier I said select Showroom','say select Showroom'])
    assert.equal((await h.run('fill_page_fields',{fields:[{field:'serviceType',value:'Showroom'}]},{userText:text})).ok,false,text);
  assert.equal(writes,0);
  assert.equal((await h.run('fill_page_fields',{fields:[{field:'serviceType',value:'Showroom'}]},{userText:'select Showroom'})).ok,true);assert.equal(writes,1);
});

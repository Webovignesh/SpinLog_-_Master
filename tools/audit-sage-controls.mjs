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
test('voice costliest-mod answer reveals the actual winner beyond the list limit and retains tied facts',async()=>{
  const h=harness(),shown=[];
  h.root.dkApp.listServices=services([{id:1,date:'2026-10-07',type:'Mods/Updates',cost:50},
    {id:2,date:'2020-01-01',type:'Mods/Updates',cost:9000,notes:'Exhaust'},
    {id:3,date:'2021-01-01',type:'Mods/Updates',cost:9000,notes:'Suspension'},
    {id:4,date:'2026-01-01',type:'Showroom',cost:18000}]);
  h.root.dkApp.showRecord=async a=>{shown.push(a);return {ok:true,highlighted:true};};
  const context={voice:true,userText:'What is my costliest mod?',relatedRecords:new Set()};
  const result=await h.run('list_services',{limit:1,type:'Showroom'},context);
  assert.equal(result.records.length,1);assert.equal(result.mostExpensive.modsAndUpdates.cost,9000);
  assert.equal(result.mostExpensive.modsAndUpdates.records.length,2);assert.equal(shown.length,1);
  assert.equal(shown[0].kind,'service');assert.ok(['2','3'].includes(shown[0].id));
  assert.equal(result.presentation.highlighted,true);
  assert.equal((await h.run('show_record',{kind:'service',id:'2'},context)).ok,true);
  assert.equal((await h.run('show_record',{kind:'service',id:'999'},context)).ok,false);
  assert.equal((await h.run('show_record',{kind:'service',id:'2',action:'edit'},context)).ok,false);
});
test('related record presentation is scoped to this voice question and preserves facts when blocked',async()=>{
  const h=harness();let shown=0;
  h.root.dkApp.listServices=services([{id:1,date:'2026-01-01',type:'Mods/Updates',cost:500}]);
  h.root.dkApp.showRecord=async()=>{shown++;return {ok:false,error:'Close the draft first.'};};
  const context={voice:true,userText:'Which is my costliest mod?'};
  const result=await h.run('list_services',{},context);
  assert.equal(result.ok,true);assert.equal(result.presentation.ok,false);assert.equal(result.mostExpensive.modsAndUpdates.cost,500);
  await h.run('list_services',{}, {voice:false,userText:'Which is my costliest mod?'});
  await h.run('list_services',{}, {voice:true,userText:"Don't show my costliest mod"});
  assert.equal(shown,1);
  assert.equal((await h.run('show_record',{kind:'service',id:'1'},{...context,userText:'hello'})).ok,false);
  assert.equal((await h.run('show_record',{kind:'service',id:'1'}, {...context,isCancelled:()=>true})).ok,false);
  assert.equal(shown,1);
});
test('cancelled read never moves the page after its network response',async()=>{
  const h=harness();let cancelled=false,shown=0;
  h.root.dkApp.listServices=async()=>{cancelled=true;return {ok:true,records:[{id:1}],mostExpensive:{everything:{records:[{id:1}]}}};};
  h.root.dkApp.showRecord=async()=>{shown++;return {ok:true};};
  assert.equal((await h.run('list_services',{}, {voice:true,userText:'what is my costliest service',isCancelled:()=>cancelled})).ok,false);
  assert.equal(shown,0);
});
test('a showroom versus mods comparison does not silently narrow the read to mods',async()=>{
  const h=harness();h.root.dkApp.listServices=services([{id:1,date:'2026-01-01',type:'Mods/Updates',cost:500},
    {id:2,date:'2026-01-02',type:'Showroom',cost:900}]);
  const result=await h.run('list_services',{}, {voice:true,userText:'Compare my showroom spending versus mods'});
  assert.equal(result.records.length,2);assert.equal(result.totals.everything,1400);
});
test('record reveal awaits render, highlights the exact row and never claims a missing record',async()=>{
  let reveal,highlighted;
  const row={};const window={SagePageControls:{inspect:()=>({dialog:null}),highlight:async el=>{highlighted=el;return {ok:true};}},
    dkShowServiceRecord:()=>new Promise(resolve=>{reveal=resolve;})};
  const show=appMethod('showRecord','navigateHistory',{window,serviceEntries:[{id:9}],CSS:{escape:String},document:{querySelector:()=>row}});
  const app={showRecord:show,goToSection:async()=>({ok:true})};
  const pending=app.showRecord({kind:'service',id:'9'});await new Promise(setImmediate);
  assert.equal(highlighted,undefined);reveal(true);assert.equal((await pending).highlighted,true);assert.equal(highlighted,row);
  assert.equal((await app.showRecord({kind:'service',id:'123'})).ok,false);
});
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

test('compound requests authorize each named UI action, with no invented destination',async()=>{
  const h=harness(),context={userText:'open service and then open documents and minimize yourself'};
  assert.equal((await h.run('navigate_section',{section:'service'},context)).ok,true);
  assert.equal((await h.run('navigate_section',{section:'docs'},context)).ok,true);
  assert.equal((await h.run('control_voice',{action:'minimize'},context)).ok,true);
  assert.equal((await h.run('navigate_section',{section:'home'},context)).ok,false);
  assert.equal((await h.run('control_voice',{action:'close'},context)).ok,false);
  assert.equal(h.root.SageTools.declarations(context).some(t=>t.name==='navigate_section'),true);
  assert.equal(h.root.SageTools.declarations(context).some(t=>t.name==='control_voice'),true);
});
test('a question or historical sentence containing several commands cannot execute its later clause',async()=>{
  for(const text of ['Earlier I said open service and close voice mode','how do I open documents and close voice mode',"don't open documents and close voice mode",'if I say open service then close voice mode','she said open service and close voice mode']) {
    const h=harness();assert.equal((await h.run('control_voice',{action:'close'},{userText:text})).ok,false,text);
    assert.equal(h.open,true);
  }
});
test('action-like words and negation in notes remain draft content and cannot close the call',async()=>{
  const h=harness();h.root.SagePageControls={fill:()=>({ok:true,saved:false})};
  for(const text of ["set notes to don't forget the helmet",'set notes to open documents and close voice mode','set notes to "open documents and then close voice mode"',"set notes to 'open documents and then close voice mode'"]) {
    const context={userText:text};
    assert.equal((await h.run('fill_page_fields',{fields:[{field:'notes',value:'draft'}]},context)).ok,true,text);
    assert.equal((await h.run('control_voice',{action:'close'},context)).ok,false,text);
    assert.equal(h.open,true);
  }
});
test('natural direct requests support compound controls while hypothetical statements stay inert',async()=>{
  for(const prefix of ['I want you to','I need you to',"I'd like you to",'I want to']) {
    const h=harness(),context={userText:prefix+' open service then minimize yourself'};
    assert.equal((await h.run('navigate_section',{section:'service'},context)).ok,true);
    assert.equal((await h.run('control_voice',{action:'minimize'},context)).ok,true);
  }
  const h=harness();assert.equal((await h.run('control_voice',{action:'close'},{userText:'I would like to know how to open service and close voice mode'})).ok,false);
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

test('opening a file requires a current explicit request and a real read proof; play needs a play request',async()=>{
 const h=harness();let opened=0;
 h.root.dkApp.openStoredFile=async()=>{opened++;return {ok:true};};
 const context={userText:'open my license',voice:true,relatedRecords:new Set(['document:Driving License'])};
 assert.equal((await h.run('open_stored_file',{kind:'document',id:'Driving License',action:'open'},context)).ok,true);
 for(const userText of ['hello','do not open my license','what did you open earlier?','say open my license'])assert.equal((await h.run('open_stored_file',{kind:'document',id:'Driving License'}, {...context,userText})).ok,false);
 assert.equal((await h.run('open_stored_file',{kind:'document',id:'unknown'},context)).ok,false);
 assert.equal((await h.run('open_stored_file',{kind:'document',id:'Driving License',action:'play'},context)).ok,false);
 assert.equal((await h.run('open_stored_file',{kind:'document',id:'Driving License'},{...context,isCancelled:()=>true})).ok,false);
 assert.equal(opened,1);
});
test('pause cannot turn into play or close and discussion never controls the player',async()=>{
 const h=harness();let actions=[];h.root.dkApp.controlMediaPlayer=async a=>{actions.push(a.action);return {ok:true};};
 assert.equal((await h.run('control_media_player',{action:'pause'},{userText:'pause video'})).ok,true);
 for(const userText of ['why did you play the video?','do not pause','hello','pause video'])assert.equal((await h.run('control_media_player',{action:'play'},{userText})).ok,false);
 assert.deepEqual(actions,['pause']);
});
test('latest file commands select the requested kind before pagination and open instead of reading it',async()=>{
 const h=harness();let listed,opened;
 h.root.dkApp.listMedia=async args=>{listed=args;return {ok:true,media:[{id:90,kind:'video',fileName:'Ride.mp4'}]};};
 h.root.dkApp.openStoredFile=async args=>{opened=args;return {ok:true,playing:true};};
 const result=await h.root.SageTools.handleFileRequest({userText:'Play the last saved archive video.',voice:true,relatedRecords:new Set()});
 assert.equal(listed.kind,'video');assert.equal(opened.id,'90');assert.equal(opened.action,'play');assert.equal(result.text,'Playing Ride.mp4.');
});
test('driver license aliases open the actual document and report a missing file truthfully',async()=>{
 const h=harness();let opened;
 h.root.dkApp.listDocuments=async()=>({ok:true,documents:[{document:'Driving License',onFile:true}]});
 h.root.dkApp.openStoredFile=async args=>{opened=args;return {ok:true};};
 let result=await h.root.SageTools.handleFileRequest({userText:"Open my driver's license.",relatedRecords:new Set()});
 assert.equal(opened.kind,'document');assert.equal(opened.id,'Driving License');assert.equal(result.text,'Opened Driving License.');
 h.root.dkApp.openStoredFile=async()=>({ok:false,error:'File link unavailable.'});
 result=await h.root.SageTools.handleFileRequest({userText:'view my licence',relatedRecords:new Set()});assert.equal(result.text,'File link unavailable.');
});

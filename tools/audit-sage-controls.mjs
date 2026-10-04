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
  let open=true,section=null,tab=null;
  const root={console:{log(){},warn(){}},
    SageVoice:{open(){open=true;return true;},close(){open=false;}},
    SageUI:{open(t){tab=t;},isOpen:()=>!!tab},...overrides};
  root.self=root;vm.runInNewContext(toolsSource,root);
  root.dkApp={goToSection:appMethod('goToSection','saveParkLocation',{setActiveSection:s=>{section=s;}}),
    openSection:appMethod('openSection','goToSection',{})};
  return {root,run:root.SageTools.run,get open(){return open;},get section(){return section;},get tab(){return tab;}};
}
test('explicit navigation opens the page and ends voice; an offer never navigates',async()=>{
  const h=harness();assert.equal((await h.run('open_section',{section:'service'})).offered,'service');
  assert.equal(h.section,null);assert.equal(h.open,true);
  assert.equal((await h.run('navigate_section',{section:'docs',highlight:'untrusted selector'},{userText:'open documents'})).opened,'docs');
  assert.equal(h.section,'docs');assert.equal(h.open,false);
});
test('unknown destinations and failed navigation leave the call intact',async()=>{
  const h=harness();assert.equal((await h.run('navigate_section',{section:'javascript:alert(1)'})).ok,false);
  assert.equal(h.open,true);assert.equal(h.section,null);
  h.root.dkApp.goToSection=async()=>({ok:false,error:'Unavailable'});
  assert.equal((await h.run('navigate_section',{section:'docs'},{userText:'open documents'})).ok,false);assert.equal(h.open,true);
});
test('voice and settings work before data loads, and only accept whitelisted controls',async()=>{
  const h=harness();delete h.root.dkApp;
  assert.equal((await h.run('control_voice',{action:'delete'})).ok,false);assert.equal(h.open,true);
  assert.equal((await h.run('control_voice',{action:'close'},{userText:'close voice mode'})).ok,true);assert.equal(h.open,false);
  assert.equal((await h.run('control_voice',{action:'open'},{userText:'open voice mode'})).ok,true);assert.equal(h.open,true);
  assert.equal((await h.run('open_sage_settings',{tab:'voice'},{userText:'open voice settings'})).ok,true);assert.equal(h.tab,'voice');assert.equal(h.open,false);
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
  for(const text of ['close voice mode','voice mode close pannu','வாய்ஸ் மோடை மூடு']) {
    assert.equal((await h.run('control_voice',{action:'close'},{userText:text})).ok,true);
  }
});

test('polite requests normalize whitespace without weakening negation protection',async()=>{
  const h=harness();
  assert.equal((await h.run('navigate_section',{section:'docs'},{userText:'Sage, could you please open   the documents page?'})).ok,true);
  assert.equal((await h.run('control_voice',{action:'close'},{userText:'Please do not close voice mode'})).ok,false);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/js/sage-ui.js',import.meta.url),'utf8');
const toolsSource=await readFile(new URL('../src/js/sage-tools.js',import.meta.url),'utf8');
function harness(){
  const input={value:'go to voice mode'},status={textContent:'',classList:{add(){},remove(){}}};
  let opened=0;
  const root={console,document:{readyState:'loading',addEventListener(){},getElementById:id=>id==='sageChatInput'?input:id==='sageChatStatus'?status:null},
    SageVoice:{open(){opened++;return true;}},localStorage:{getItem:()=>null},addEventListener(){}};
  root.window=root;root.self=root;vm.runInNewContext(toolsSource,root);vm.runInNewContext(source,root);
  return {root,input,status,get opened(){return opened;}};
}
test('explicit chat voice commands open synchronously without an AI request',async()=>{
  const h=harness();for(const text of ['go to voice mode','Sage, switch to voice chat','please open voice mode','let’s talk'.replace('’',"'"),'voice mode!','வாய்ஸ் மோட் ஓபன் பண்ணு','வாய்ஸ் மோடை திற','voice mode open pannu']){
    const before=h.opened;const done=h.root.SageUI.sendChat(text);
    assert.equal(h.opened,before+1,'must preserve click/keyboard gesture for audio unlock');await done;
    assert.equal(h.input.value,'');
  }
});
test('negations and discussion about voice mode do not activate it',async()=>{
  const h=harness();for(const text of ["don't go to voice mode",'why is voice mode slow?', 'she said go to voice mode'])await h.root.SageUI.sendChat(text);
  assert.equal(h.opened,0);
});

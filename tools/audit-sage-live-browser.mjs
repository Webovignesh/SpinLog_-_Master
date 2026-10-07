// Real Chromium mic + production AudioWorklet + Live wire protocol.
// Provider messages are simulated; no API keys, external calls or database.
import http from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
let chromium;
try{({chromium}=await import('playwright'));}
catch{({chromium}=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs'))));}
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const fixture=JSON.parse(await readFile(path.join(root,'tools/fixtures/sage-english-speech.json'),'utf8'));
const raw=Buffer.from(fixture.pcm,'base64'),wavHeader=Buffer.alloc(44);
wavHeader.write('RIFF');wavHeader.writeUInt32LE(raw.length+36,4);wavHeader.write('WAVEfmt ',8);
wavHeader.writeUInt32LE(16,16);wavHeader.writeUInt16LE(1,20);wavHeader.writeUInt16LE(1,22);
wavHeader.writeUInt32LE(16000,24);wavHeader.writeUInt32LE(32000,28);wavHeader.writeUInt16LE(2,32);wavHeader.writeUInt16LE(16,34);
wavHeader.write('data',36);wavHeader.writeUInt32LE(raw.length,40);
await writeFile('/tmp/sage-live-mic.wav',Buffer.concat([wavHeader,raw]));
const server=http.createServer(async(req,res)=>{
  const rel=req.url.split('?')[0].replace(/^\/+/, '')||'index.html',file=path.resolve(root,rel);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{let data=await readFile(file);
    if(rel==='index.html')data=data.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>',
      '<script src="src/js/sage-transcription.js?v=1.9.43"></script><script src="src/js/sage-voice.js?v=1.9.43"></script></body>');
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(data);
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;let browser;
try{
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture=/tmp/sage-live-mic.wav']});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.addInitScript(()=>{
    window.ears=[];window.asks=[];window.requests=[];window.browserStarts=0;
    const getMic=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.micOpens=0;
    navigator.mediaDevices.getUserMedia=async constraints=>{
      micOpens++;
      const stream=await getMic(constraints),ctx=new AudioContext();
      const source=ctx.createMediaStreamSource(stream),gain=ctx.createGain(),out=ctx.createMediaStreamDestination();
      gain.gain.value=0;source.connect(gain);gain.connect(out);window.testMicGain=gain;
      out.stream.getTracks()[0].onended=()=>{stream.getTracks().forEach(t=>t.stop());ctx.close();};
      return out.stream;
    };
    window.SpeechRecognition=class{start(){browserStarts++;}abort(){}};
    window.WebSocket=class{
      readyState=0;sent=[];packets=[];turn=0;turnPackets=0;byTurn=[];
      constructor(){this.id=ears.length;ears.push(this);setTimeout(()=>{this.readyState=1;this.onopen?.();},0);}
      message(value){this.onmessage?.({data:JSON.stringify(value)});}
      send(raw){const value=JSON.parse(raw);this.sent.push(value);
        if(value.setup)setTimeout(()=>this.message({setupComplete:{}}),this.id===0?700:0);
        if(value.realtimeInput?.audio){this.packets.push(value.realtimeInput.audio);
          (this.byTurn[this.turn] ||= []).push(value.realtimeInput.audio);this.turnPackets++;
          if(this.turnPackets===6 && this.turn<6){
            if(this.turn<5)window.testMicGain.gain.value=0; // a real pause, not a provider shortcut
            this.message({serverContent:{interimInputTranscription:{text:this.turn%2?'tell me more':'hello there'}}});
            if(this.turn<5)setTimeout(()=>this.message({serverContent:{inputTranscription:{text:this.turn%2?'tell me more':'hello there'},generationComplete:true}}),50);
          }
        }
        if(value.realtimeInput?.audioStreamEnd){
          if(this.turn<5)this.message({serverContent:{turnComplete:true}});
          if(this.turn===5)this.message({serverContent:{inputTranscription:{text:'tell me more'}}});
          // Seventh utterance: connected provider returns no usable words.
          this.turn++;this.turnPackets=0;
        }
      }
      close(){this.readyState=3;}
    };
    let history=[];window.dkCloudStore={chatHistory:()=>history,setChat:rows=>history=rows};
    window.SageAI={availableKeys:()=>[{key:'test-only'}],askSage:async text=>{asks.push(text);return {ok:true,text:'Okay, I heard you.'};}};
    const pcm=new Int16Array(4800);for(let i=0;i<pcm.length;i++)pcm[i]=Math.sin(i/6)*5000;
    const data=btoa(String.fromCharCode(...new Uint8Array(pcm.buffer)));
    window.fetch=async(url,init)=>{
      const body=JSON.parse(init.body);requests.push({url,body});
      if(!body.generationConfig.responseModalities)return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({transcript:'Fallback audio was preserved',unclear:false})}]}}]})};
      return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{inlineData:{mimeType:'audio/L16;rate=24000',data}}]}}]})};
    };
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{
    document.querySelectorAll('main section').forEach(s=>s.classList.toggle('active',s.id==='sage'));document.getElementById('sage').style.display='block';
    window.readiness=[];window.visuals=[];window.autoMic=false;window.startedTurn=0;
    const status=document.getElementById('sageVoiceState'),orb=document.getElementById('sageVoiceOrb');
    new MutationObserver(()=>{
      readiness.push(status.textContent);
      if(autoMic && status.textContent==='Listening…' && ears[0].turn>startedTurn && ears[0].turn<7){
        startedTurn=ears[0].turn;setTimeout(()=>{testMicGain.gain.value=1;},120);
      }
    }).observe(status,{childList:true});
    new MutationObserver(()=>visuals.push({mode:orb.dataset.voiceMode,level:Number(orb.style.getPropertyValue('--sage-voice-level')),
      transform:getComputedStyle(orb.querySelector('.sage-voice-core')).transform})).observe(orb,{attributes:true,attributeFilter:['style']});
  });
  await page.locator('#sageChatMic').click();
  await page.waitForFunction(()=>document.getElementById('sageVoiceState').textContent==='Listening…');
  await page.waitForTimeout(1000);
  assert.deepEqual(await page.evaluate(()=>({asks:asks.length,requests:requests.length,packets:ears[0].packets.length})),
    {asks:0,requests:0,packets:0},'cold boot silence never starts recognition processing or replies');
  await page.evaluate(()=>{autoMic=true;testMicGain.gain.value=1;});
  await page.waitForFunction(()=>asks.length>=5&&document.getElementById('sageVoiceState').textContent==='Listening…',{},{timeout:30000});
  await page.waitForFunction(()=>ears[0]?.byTurn[5]?.length>=6);
  await page.locator('#sageVoiceOrb').click();
  await page.waitForFunction(()=>asks.length===6&&document.getElementById('sageVoiceState').textContent==='Listening…');
  await page.waitForFunction(()=>ears[0]?.byTurn[6]?.length>=6);
  await page.locator('#sageVoiceOrb').click();
  await page.waitForFunction(()=>asks.length===7&&document.getElementById('sageVoiceState').textContent==='Listening…');
  const result=await page.evaluate(()=>({asks,requests,ears:ears.map(e=>({sent:e.sent,packets:e.packets,byTurn:e.byTurn,readyState:e.readyState})),browserStarts,readiness,visuals}));
  assert.ok(result.readiness.includes('Connecting…'),'cold startup is visible before real PCM arrives');
  assert.ok(result.readiness.includes('Connecting…'),'live setup wait is visible while the first audio is buffered');
  assert.ok(result.visuals.some(v=>v.mode==='listening'&&v.level>.02),'real microphone samples animate the orb');
  assert.ok(result.visuals.some(v=>v.mode==='speaking'&&v.level>.02),'real reply playback animates the orb');
  assert.ok(new Set(result.visuals.map(v=>v.transform)).size>3,'orb transforms follow changing amplitude');
  assert.deepEqual(result.asks.slice(0,5),['hello there','tell me more','hello there','tell me more','hello there']);
  assert.deepEqual(result.asks.slice(5),['tell me more','Fallback audio was preserved']);
  assert.equal(result.browserStarts,0);assert.equal(result.requests.length,8,'only the silent connection needs one batch fallback');
  const replies=result.requests.filter(r=>r.body.generationConfig.responseModalities?.[0]==='AUDIO');
  assert.equal(replies.length,7);
  const voice=result.requests[0].body.generationConfig.speechConfig.voiceConfig.voice;
  assert.ok(replies.every(r=>r.body.generationConfig.speechConfig.voiceConfig.voice===voice));
  assert.equal(result.ears.length,1,'six successful turns reuse one connection; a silent route is cooled down');
  assert.equal(await page.evaluate(()=>micOpens),1,'all turns keep the same microphone');
  const fallback=result.requests.find(r=>!r.body.generationConfig.responseModalities);
  const wav=Buffer.from(fallback.body.contents[0].parts[0].inlineData.data,'base64');
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),16000);
  for(const ear of result.ears){
    assert.ok(ear.sent[0].setup.model==='models/gemini-3.5-transcribe-live');
    assert.ok(ear.sent.some(m=>m.realtimeInput?.audioStreamEnd),'each utterance ends its audio stream');
    assert.ok(ear.packets.every(p=>p.mimeType==='audio/pcm;rate=16000'));
    const audio=Buffer.concat(ear.packets.map(p=>Buffer.from(p.data,'base64')));
    let peak=0;for(let i=0;i<audio.length;i+=2)peak=Math.max(peak,Math.abs(audio.readInt16LE(i)));
    assert.ok(peak>100,'real worklet captures microphone audio');
    const finalAudio=Buffer.concat(ear.byTurn[6].map(p=>Buffer.from(p.data,'base64')));
    // The full PCM includes at most the local pre-roll before the speech gate.
    assert.ok(wav.subarray(44).includes(finalAudio),'fallback preserves exactly the streamed speech and first-word prefix');
  }
  await page.locator('#sageVoiceEnd').click();
  assert.equal(await page.evaluate(()=>ears.every(e=>e.readyState===3)),true,'end call releases every socket');
  await page.waitForTimeout(100);const stoppedCount=await page.evaluate(()=>visuals.length);
  await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>visuals.length),stoppedCount,'no visualizer frames after close');
  assert.deepEqual(errors,[]);
  console.log('✓ Real microphone/worklet: visible cold startup, reactive input/output orb, five English turns, committed input without model acknowledgement, silent-provider PCM fallback, one speaker and cleanup');
}finally{await browser?.close();server.close();}

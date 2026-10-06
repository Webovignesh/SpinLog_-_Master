// Real Chromium mic + production AudioWorklet + Live wire protocol.
// Provider messages are simulated; no API keys, external calls or database.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
let chromium;
try{({chromium}=await import('playwright'));}
catch{({chromium}=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs'))));}
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const server=http.createServer(async(req,res)=>{
  const rel=req.url.split('?')[0].replace(/^\/+/, '')||'index.html',file=path.resolve(root,rel);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{let data=await readFile(file);
    if(rel==='index.html')data=data.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>',
      '<script src="src/js/sage-transcription.js?v=1.9.35"></script><script src="src/js/sage-voice.js?v=1.9.35"></script></body>');
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(data);
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;let browser;
try{
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.addInitScript(()=>{
    window.ears=[];window.asks=[];window.requests=[];window.browserStarts=0;
    window.SpeechRecognition=class{start(){browserStarts++;}abort(){}};
    window.WebSocket=class{
      readyState=0;sent=[];packets=[];
      constructor(){this.id=ears.length;ears.push(this);setTimeout(()=>{this.readyState=1;this.onopen?.();},0);}
      message(value){this.onmessage?.({data:JSON.stringify(value)});}
      send(raw){const value=JSON.parse(raw);this.sent.push(value);
        if(value.setup)setTimeout(()=>this.message({setupComplete:{}}),this.id===0?700:0);
        if(value.realtimeInput?.audio){this.packets.push(value.realtimeInput.audio);
          if(this.packets.length===6 && this.id<6){
            this.message({serverContent:{interimInputTranscription:{text:this.id%2?'சொல்லு டா':'hello there'}}});
            if(this.id<5)setTimeout(()=>this.message({serverContent:{inputTranscription:{text:this.id%2?'சொல்லு டா':'hello there'},generationComplete:true}}),50);
          }
        }
        if(value.realtimeInput?.audioStreamEnd){
          if(this.id<5)this.message({serverContent:{turnComplete:true}});
          if(this.id===5)this.message({serverContent:{inputTranscription:{text:'சொல்லு டா'}}});
          // The seventh connection acknowledges setup and receives audio, but
          // never returns any transcript or model output.
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
    window.readiness=[];window.visuals=[];
    const status=document.getElementById('sageVoiceState'),orb=document.getElementById('sageVoiceOrb');
    new MutationObserver(()=>readiness.push(status.textContent)).observe(status,{childList:true});
    new MutationObserver(()=>visuals.push({mode:orb.dataset.voiceMode,level:Number(orb.style.getPropertyValue('--sage-voice-level')),
      transform:getComputedStyle(orb.querySelector('.sage-voice-core')).transform})).observe(orb,{attributes:true,attributeFilter:['style']});
  });
  await page.locator('#sageChatMic').click();
  await page.waitForFunction(()=>asks.length>=5&&document.getElementById('sageVoiceState').textContent==='I’m listening',{},{timeout:15000});
  await page.waitForFunction(()=>ears[5]?.packets.length>=6);
  await page.locator('#sageVoiceOrb').click();
  await page.waitForFunction(()=>asks.length===6&&document.getElementById('sageVoiceState').textContent==='I’m listening');
  await page.waitForFunction(()=>ears[6]?.packets.length>=6);
  await page.locator('#sageVoiceOrb').click();
  await page.waitForFunction(()=>asks.length===7&&document.getElementById('sageVoiceState').textContent==='I’m listening');
  const result=await page.evaluate(()=>({asks,requests,ears:ears.map(e=>({sent:e.sent,packets:e.packets,readyState:e.readyState})),browserStarts,readiness,visuals}));
  assert.ok(result.readiness.includes('Starting audio…'),'cold startup is visible before real PCM arrives');
  assert.ok(result.readiness.includes('Connecting…'),'live setup wait is visible while the first audio is buffered');
  assert.ok(result.visuals.some(v=>v.mode==='listening'&&v.level>.02),'real microphone samples animate the orb');
  assert.ok(result.visuals.some(v=>v.mode==='speaking'&&v.level>.02),'real reply playback animates the orb');
  assert.ok(new Set(result.visuals.map(v=>v.transform)).size>3,'orb transforms follow changing amplitude');
  assert.deepEqual(result.asks.slice(0,5),['hello there','சொல்லு டா','hello there','சொல்லு டா','hello there']);
  assert.deepEqual(result.asks.slice(5),['சொல்லு டா','Fallback audio was preserved']);
  assert.equal(result.browserStarts,0);assert.equal(result.requests.length,8,'only the silent connection needs one batch fallback');
  const replies=result.requests.filter(r=>r.body.generationConfig.responseModalities?.[0]==='AUDIO');
  assert.equal(replies.length,7);
  const voice=result.requests[0].body.generationConfig.speechConfig.voiceConfig.voice;
  assert.ok(replies.every(r=>r.body.generationConfig.speechConfig.voiceConfig.voice===voice));
  assert.equal(result.ears.length,7,'the silent route is not reconnected on the next turn');
  const fallback=result.requests.find(r=>!r.body.generationConfig.responseModalities);
  const wav=Buffer.from(fallback.body.contents[0].parts[0].inlineData.data,'base64');
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),16000);
  for(const ear of result.ears){
    assert.ok(ear.sent[0].setup.model==='models/gemini-3.8-live');
    assert.ok(ear.sent.some(m=>m.realtimeInput?.audioStreamEnd),'each utterance ends its audio stream');
    assert.ok(ear.packets.every(p=>p.mimeType==='audio/pcm;rate=16000'));
    const audio=Buffer.concat(ear.packets.map(p=>Buffer.from(p.data,'base64')));
    let peak=0;for(let i=0;i<audio.length;i+=2)peak=Math.max(peak,Math.abs(audio.readInt16LE(i)));
    assert.ok(peak>100,'real worklet captures microphone audio');
    if(ear===result.ears[6])assert.equal(wav.subarray(44).equals(audio),true,'fallback uses exactly the streamed microphone PCM');
  }
  await page.locator('#sageVoiceEnd').click();
  assert.equal(await page.evaluate(()=>ears.every(e=>e.readyState===3)),true,'end call releases every socket');
  await page.waitForTimeout(100);const stoppedCount=await page.evaluate(()=>visuals.length);
  await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>visuals.length),stoppedCount,'no visualizer frames after close');
  assert.deepEqual(errors,[]);
  console.log('✓ Real microphone/worklet: visible cold startup, reactive input/output orb, five bilingual turns, committed input without model acknowledgement, silent-provider PCM fallback, one speaker and cleanup');
}finally{await browser?.close();server.close();}

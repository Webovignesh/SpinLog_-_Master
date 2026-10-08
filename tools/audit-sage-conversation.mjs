// Real Chromium PCM/VAD, speech interruption and long turns. Provider replies
// are fixtures; this does not measure live-account latency or physical echo.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
let chromium;
try{({chromium}=await import('playwright'));}
catch{({chromium}=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs'))));}
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const fixture=JSON.parse(await readFile(path.join(root,'tools/fixtures/sage-english-speech.json'),'utf8'));
const replyPCM=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',
  'flite=text=Your maintenance records are ready. Let me explain the recent service and your upcoming reminders.:voice=slt',
  '-ar','24000','-ac','1','-f','s16le','pipe:1'],{maxBuffer:2*1024*1024}).toString('base64');
const server=http.createServer(async(req,res)=>{
  const rel=req.url.split('?')[0].replace(/^\/+/, '')||'index.html',file=path.resolve(root,rel);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{let data=await readFile(file);
    if(rel==='index.html')data=data.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>',
      '<script src="src/js/sage-transcription.js"></script><script src="src/js/sage-voice.js"></script></body>');
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(data);
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;let browser;
try{
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.addInitScript(({fixture,replyPCM})=>{
    window.asks=[];window.requests=[];window.audioContexts=[];window.micOpens=0;window.echoEnabled=false;
    const AC=window.AudioContext;
    window.AudioContext=class extends AC{constructor(...args){super(...args);audioContexts.push(this);}};
    const getMic=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{
      micOpens++;const hardware=await getMic(constraints),ctx=audioContexts[0],out=ctx.createMediaStreamDestination();
      const binary=atob(fixture),view=new DataView(Uint8Array.from(binary,c=>c.charCodeAt(0)).buffer);
      const buffer=ctx.createBuffer(1,view.byteLength/2,16000),samples=buffer.getChannelData(0);
      for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(i*2,true)/32768;
      const source=ctx.createBufferSource();source.buffer=buffer;source.loop=true;
      window.testMicGain=ctx.createGain();testMicGain.gain.value=0;source.connect(testMicGain);testMicGain.connect(out);source.start();
      window.echoGain=ctx.createGain();echoGain.gain.value=.45;
      const delay=ctx.createDelay();delay.delayTime.value=.08;echoGain.connect(delay);delay.connect(out);
      out.stream.getTracks()[0].onended=()=>hardware.getTracks().forEach(t=>t.stop());return out.stream;
    };
    const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){if(echoEnabled && this.buffer?.sampleRate===24000)this.connect(echoGain);return start.apply(this,args);};
    window.WebSocket=undefined;window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;
    let history=[];window.dkCloudStore={chatHistory:()=>history,setChat:rows=>history=rows};
    window.SageAI={availableKeys:()=>[{key:'test-only'}],askSage:async text=>{asks.push(text);return {ok:true,text:'Your records are ready.'};}};
    window.fetch=async(url,init)=>{
      const body=JSON.parse(init.body);requests.push({url,body});
      if(body.generationConfig.responseModalities)return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{inlineData:{mimeType:'audio/L16;rate=24000',data:replyPCM}}]}}]})};
      return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({transcript:'Open the service page',unclear:false})}]}}]})};
    };
  },{fixture:fixture.pcm,replyPCM});
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{
    window.frameCosts=[];
    const attach=SageTranscription.attach;
    SageTranscription.attach=(stream,context,handler)=>attach(stream,context,frame=>{
      const started=performance.now();handler(frame);frameCosts.push(performance.now()-started);
    });
    document.querySelectorAll('main section').forEach(s=>s.classList.toggle('active',s.id==='sage'));
    document.getElementById('sage').style.display='block';
  });
  await page.locator('#sageChatMic').click();
  await page.waitForFunction(()=>SageVoice.diagnostics().capture?.ready);
  // Actual speaker PCM is fed into the mic, with delay and gain: no self-interruption.
  await page.evaluate(()=>{echoEnabled=true;SageVoice.sendVoiceText('Explain my service history');});
  await page.waitForFunction(()=>document.getElementById('sageVoiceState').textContent==='Replying…');
  await page.waitForFunction(()=>SageVoice.diagnostics().recording,null,{timeout:15000});
  assert.equal(await page.evaluate(()=>SageVoice.diagnostics().events.filter(e=>e.event==='spoken-interruption').length),0);
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(()=>asks.length),1,'the acoustic reply tail cannot become a new command');
  // Cut an actual playing reply using classified microphone speech.
  await page.evaluate(()=>{echoEnabled=false;SageVoice.sendVoiceText('Explain the latest upgrade');});
  await page.waitForFunction(()=>document.getElementById('sageVoiceState').textContent==='Replying…' && document.getElementById('sageVoiceOverlay').dataset.canInterrupt==='true');
  const before=await page.evaluate(()=>performance.now());
  await page.evaluate(()=>{testMicGain.gain.value=1;});
  await page.waitForFunction(()=>SageVoice.diagnostics().events.some(e=>e.event==='spoken-interruption'),null,{timeout:4000});
  const elapsed=await page.evaluate(()=>performance.now())-before;
  assert.ok(elapsed<4000,'speech interrupts while the real audio source is playing');
  await page.waitForFunction(()=>SageVoice.diagnostics().recording);
  await page.waitForTimeout(650);await page.evaluate(()=>{testMicGain.gain.value=0;});
  await page.waitForFunction(()=>asks.length===3,null,{timeout:10000});
  await page.waitForFunction(()=>SageVoice.diagnostics().recording,null,{timeout:15000});
  assert.equal(await page.evaluate(()=>micOpens),1,'interruption retains the microphone stream');
  // This part intentionally lasts more than the old 45-second limit.
  await page.evaluate(()=>{testMicGain.gain.value=1;});
  await page.waitForTimeout(47000);
  assert.equal(await page.evaluate(()=>asks.length),3,'continuous speech is not submitted at 45 seconds');
  assert.equal(await page.evaluate(()=>SageVoice.diagnostics().recording),true);
  await page.evaluate(()=>{testMicGain.gain.value=0;});
  await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>asks.length),3,'long speech retains breathing space');
  await page.waitForFunction(()=>asks.length===4,null,{timeout:10000});
  await page.waitForFunction(()=>SageVoice.diagnostics().recording,null,{timeout:15000});
  await page.locator('#sageVoiceEnd').click();assert.deepEqual(errors,[]);
  const costs=await page.evaluate(()=>frameCosts.slice().sort((a,b)=>a-b));
  console.log(`✓ Real PCM/VAD interruption (${Math.round(elapsed)} ms), delayed speaker echo/tail rejection, one microphone, a >45-second turn, breathing space, and automatic listening recovery; PCM handler p95 ${costs[Math.floor(costs.length*.95)].toFixed(1)} ms`);
}finally{await browser?.close();server.close();}

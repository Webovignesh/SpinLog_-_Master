// Real Chromium MediaRecorder -> Web Audio decoder -> WAV -> mocked HTTP.
// No API keys or external calls; browser microphone uses Chromium's fake device.
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
let chromium;
try {({chromium}=await import('playwright'));}
catch {({chromium}=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs'))));}
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const server=http.createServer(async(req,res)=>{
  const rel=req.url.split('?')[0].replace(/^\/+/, '')||'index.html', file=path.resolve(root,rel);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try {let data=await readFile(file);if(rel==='index.html')data=data.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>','<script src="src/js/sage-voice.js"></script></body>');
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(data);
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.addInitScript(()=>{
    window.SpeechRecognition=class {constructor(){window.voicePreview=this;} start(){} abort(){} stop(){}};
    window.recordedRequests=[];window.replies=[];window.failRecognition=true;
    window.SageAI={availableKeys:()=>[{key:'test-only'}],askSage:async text=>{replies.push(text);return {ok:true,text:'Okay, heard you.'};}};
    let history=[];window.dkCloudStore={chatHistory:()=>history,setChat:rows=>history=rows};
    const pcm=new Int16Array(2400);for(let i=0;i<pcm.length;i++)pcm[i]=Math.sin(i/6)*5000;
    const speech=btoa(String.fromCharCode(...new Uint8Array(pcm.buffer)));
    window.fetch=async(url,init)=>{
      const body=JSON.parse(init.body);
      if(body.generationConfig.responseModalities)return {ok:true,json:async()=>({candidates:[{content:{parts:[{inlineData:{mimeType:'audio/L16;rate=24000',data:speech}}]}}]})};
      recordedRequests.push({url,body});
      if(failRecognition)return {ok:false,status:503,json:async()=>({error:{message:'test outage'}})};
      return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({transcript:'சொல்லு டா',unclear:false})}]}}]})};
    };
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{document.querySelectorAll('main section').forEach(s=>s.classList.toggle('active',s.id==='sage'));document.getElementById('sage').style.display='block';});
  await page.locator('#sageChatMic').click();
  await page.waitForFunction(()=>document.getElementById('sageVoiceState').textContent==='I’m listening');
  await page.waitForTimeout(800);await page.locator('#sageVoiceOrb').click();
  await page.locator('#sageVoiceSTTError').waitFor({state:'visible'});
  const requests=await page.evaluate(()=>recordedRequests);
  assert.equal(requests.length,2,'one bounded server retry');
  const wav=Buffer.from(requests[0].body.contents[0].parts[0].inlineData.data,'base64');
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),16000);assert.ok(wav.length>16000,'real recording decoded to PCM');
  let peak=0;for(let i=44;i<wav.length;i+=2)peak=Math.max(peak,Math.abs(wav.readInt16LE(i)));assert.ok(peak>100,'recording contains real fake-device audio');
  await page.waitForTimeout(2200);
  assert.equal(await page.evaluate(()=>recordedRequests.length),2,'no reconnect/upload loop');
  assert.equal(await page.locator('#sageVoiceState').textContent(),'Couldn’t transcribe');
  for(const [width,height] of [[390,844],[320,568]]){
    await page.setViewportSize({width,height});
    for(const id of ['sageVoiceSTTRetry','sageVoiceEnd']){
      if(await page.locator('#'+id).isVisible()){const b=await page.locator('#'+id).boundingBox();assert.ok(b.y>=0&&b.y+b.height<=height,`${id} fits ${width}x${height}`);}
    }
  }
  await mkdir('/tmp/sage-capture-preview',{recursive:true});await page.screenshot({path:'/tmp/sage-capture-preview/recovery.png'});
  await page.evaluate(()=>{failRecognition=false;});await page.locator('#sageVoiceSTTRetry').click();
  await page.waitForFunction(()=>replies.length===1 && document.getElementById('sageVoiceState').textContent==='I’m listening');
  const retry=await page.evaluate(()=>recordedRequests[2]);assert.equal(retry.body.contents[0].parts[0].inlineData.data,requests[0].body.contents[0].parts[0].inlineData.data,'retry uses identical saved audio');
  for(let i=0;i<4;i++){
    await page.waitForTimeout(600);
    await page.locator('#sageVoiceOrb').click();
    await page.waitForFunction(n=>replies.length===n && document.getElementById('sageVoiceState').textContent==='I’m listening',i+2);
  }
  await page.locator('#sageVoiceEnd').click();
  assert.deepEqual(errors,[]);
  console.log('✓ Real MediaRecorder/decoder/WAV path, bounded outage recovery, identical-audio retry, five completed turns full-audio handoff, and phone recovery controls');
}finally{await browser?.close();server.close();}

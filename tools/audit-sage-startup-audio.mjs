// Cold AudioWorklet load + real recorder/decoder/VAD and Web Audio playback.
// Provider responses are simulated; no API keys, database or external calls.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
let chromium;
try{({chromium}=await import('playwright'));}
catch{({chromium}=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs'))));}
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const fixture=JSON.parse(await readFile(path.join(root,'tools/fixtures/sage-english-speech.json'),'utf8'));
const server=http.createServer(async(req,res)=>{
  const rel=req.url.split('?')[0].replace(/^\/+/, '')||'index.html',file=path.resolve(root,rel);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{let data=await readFile(file);
    if(rel==='index.html')data=data.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>',
      '<script src="src/js/sage-transcription.js?v=1.9.41"></script><script src="src/js/sage-voice.js?v=1.9.41"></script></body>');
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(data);
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;let browser;
try{
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
  for(const scenario of ['noise','first-word']){
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
    await page.addInitScript(({scenario,fixture})=>{
      window.requests=[];window.asks=[];window.modes=[];window.historyRows=[];window.inputFrames=0;window.outputStarts=0;
      window.audioContexts=[];window.failStream=true;window.interruptOutput=false;
      const AC=window.AudioContext;
      window.AudioContext=class extends AC{constructor(...args){super(...args);audioContexts.push(this);}};
      const addModule=AudioWorklet.prototype.addModule;
      AudioWorklet.prototype.addModule=function(...args){return new Promise((resolve,reject)=>{
        setTimeout(()=>addModule.apply(this,args).then(resolve,reject),2200);
      });};
      const start=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer?.sampleRate===24000)outputStarts++;return start.apply(this,args);};
      const getMic=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia=async constraints=>{
        const original=await getMic(constraints),ctx=new AudioContext(),out=ctx.createMediaStreamDestination();
        const input=ctx.createBuffer(1,48000,16000),samples=input.getChannelData(0);
        if(scenario==='noise'){
          let seed=11;
          for(let i=0;i<5600;i++){seed=(seed*1664525+1013904223)>>>0;
            samples[i]=Math.sin(2*Math.PI*100*i/16000)*.016+(seed/4294967296-.5)*.009;}
        }else{
          const binary=atob(fixture),raw=Uint8Array.from(binary,c=>c.charCodeAt(0)),view=new DataView(raw.buffer);
          for(let i=0;i<9600;i++)samples[i]=view.getInt16(i*2,true)/32768;
        }
        const source=ctx.createBufferSource();source.buffer=input;source.connect(out);source.start();await ctx.resume();
        out.stream.getTracks()[0].onended=()=>{original.getTracks().forEach(t=>t.stop());ctx.close();};
        return out.stream;
      };
      // No Live route: force the full, genuine recorded prefix through local VAD.
      window.WebSocket=undefined;window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;
      window.dkCloudStore={chatHistory:()=>historyRows,setChat:rows=>historyRows=rows};
      window.SageAI={availableKeys:()=>[{key:'test-only'}],askSage:async text=>{asks.push(text);return {ok:true,text:'Hello, Viky.'};}};
      const pcm=new Int16Array(4800);for(let i=0;i<pcm.length;i++)pcm[i]=Math.sin(i/6)*5000;
      const wav=new ArrayBuffer(44+pcm.byteLength),view=new DataView(wav),bytes=new Uint8Array(wav);
      const str=(at,s)=>[...s].forEach((c,i)=>bytes[at+i]=c.charCodeAt(0));
      str(0,'RIFF');view.setUint32(4,wav.byteLength-8,true);str(8,'WAVEfmt ');view.setUint32(16,16,true);
      view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,24000,true);view.setUint32(28,48000,true);
      view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,pcm.byteLength,true);bytes.set(new Uint8Array(pcm.buffer),44);
      const data=btoa(String.fromCharCode(...bytes));
      window.fetch=async(url,init)=>{
        const body=JSON.parse(init.body);requests.push({url,body});
        if(body.generationConfig.responseModalities){
          if(url.includes(':streamGenerateContent')&&failStream)throw new TypeError('simulated broken streaming connection');
          if(interruptOutput){interruptOutput=false;await audioContexts[0].suspend();}
          return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{inlineData:{mimeType:'audio/wav',data}}]}}]})};
        }
        return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({transcript:'Hello',unclear:false})}]}}]})};
      };
    },{scenario,fixture:fixture.pcm});
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.evaluate(()=>{
      document.querySelectorAll('main section').forEach(s=>s.classList.toggle('active',s.id==='sage'));
      document.getElementById('sage').style.display='block';
      new MutationObserver(()=>modes.push(document.getElementById('sageVoiceState').textContent))
        .observe(document.getElementById('sageVoiceState'),{childList:true});
    });
    await page.locator('#sageChatMic').click();
    if(scenario==='noise'){
      await page.waitForTimeout(3200);
      const result=await page.evaluate(()=>({requests:requests.length,asks:asks.length,history:historyRows.length,modes,state:document.getElementById('sageVoiceState').textContent}));
      assert.deepEqual([result.requests,result.asks,result.history],[0,0,0],'startup noise is checked locally, never uploaded or answered');
      assert.ok(!result.modes.includes('Processing…'),'no silent startup processing flash');
      assert.equal(result.state,'I’m listening');
    }else{
      await page.waitForFunction(()=>asks.length===1&&document.getElementById('sageVoiceState').textContent==='I’m listening',null,{timeout:10000});
      const result=await page.evaluate(()=>({requests,asks,history:historyRows.length,outputStarts,modes}));
      assert.deepEqual(result.asks,['Hello']);assert.equal(result.history,2);assert.equal(result.outputStarts,1,'actual audio is scheduled once');
      assert.equal(result.requests.length,3,'one STT request and bounded same-speaker speech recovery');
      assert.ok(result.modes.includes('Speaking'));
      assert.match(result.requests[1].url,/:streamGenerateContent/);assert.match(result.requests[2].url,/:generateContent$/);
      assert.deepEqual(result.requests[2].body,result.requests[1].body);
      const recording=Buffer.from(result.requests[0].body.contents[0].parts[0].inlineData.data,'base64');
      assert.ok(recording.length>32000,'complete recording contains the first word before the worklet is ready');
      await page.evaluate(async()=>{failStream=false;interruptOutput=true;await SageVoice.sendVoiceText('Tell me more');});
      await page.waitForFunction(()=>document.getElementById('sageVoiceState').textContent==='I’m listening');
      assert.deepEqual(await page.evaluate(()=>[asks.length,historyRows.length,outputStarts,requests.length,audioContexts[0].state]),
        [2,4,2,4,'running'],'a real context suspended during synthesis resumes and plays without another API request');
    }
    assert.deepEqual(errors,[]);await page.locator('#sageVoiceEnd').click();await page.close();
    console.log(`✓ Cold-load ${scenario}: real MediaRecorder, local speech classification, no invented turn, correct audio handoff`);
  }
}finally{await browser?.close();server.close();}

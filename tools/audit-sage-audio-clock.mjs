// Render the production playback scheduler with Chromium's real Web Audio engine.
// No provider, microphone, network or credentials. Tests the streamed PCM seam.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
let chromium;
try {({chromium}=await import('playwright'));}
catch {({chromium}=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs'))));}
const source=await readFile(new URL('../src/js/sage-voice.js',import.meta.url),'utf8');
const scheduler=source.slice(source.indexOf('  async function playSpeech('),source.indexOf('\n  function stopAllAudio()'));
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
try {
  const page=await browser.newPage();
  const result=await page.evaluate(async scheduler=>{
    async function render(chunked) {
      const context=new OfflineAudioContext(1,48000,48000);
      // Offline contexts are suspended until rendering starts; all other calls
      // and the audio clock are real. The scheduler is extracted unchanged.
      const actx=new Proxy(context,{get(target,key){if(key==='state')return 'running';const value=target[key];return typeof value==='function'?value.bind(target):value;}});
      const make=new Function('actx',`const S={open:true,voiceRate:1.08}, voiceSession=1, settings={rate:1.08}, playbackSources=new Map(); let playbackNextAt=0; function setMode(){}; ${scheduler}; return playSpeech;`);
      const play=make(actx),rate=24000,samples=new Float32Array(12000);
      for(let i=0;i<samples.length;i++)samples[i]=Math.sin(2*Math.PI*317*i/rate)*.3;
      const jobs=[];
      if(chunked)for(let offset=0;offset<samples.length;offset+=3000)jobs.push(play({samples:samples.slice(offset,offset+3000),rate},1));
      else jobs.push(play({samples,rate},1));
      const buffer=await context.startRendering();await Promise.all(jobs);
      return buffer.getChannelData(0);
    }
    const whole=await render(false),chunks=await render(true);
    let maxError=0,rmsError=0,missing=0;
    for(let i=0;i<whole.length;i++){
      const d=Math.abs(whole[i]-chunks[i]);maxError=Math.max(maxError,d);rmsError+=d*d;
      if(Math.abs(whole[i])>.1 && Math.abs(chunks[i])<.00001)missing++;
    }
    return {maxError,rmsError:Math.sqrt(rmsError/whole.length),missing};
  },scheduler);
  console.log(result);
  assert.ok(result.maxError<0.03,'stream seams must closely match an uninterrupted waveform');
  assert.equal(result.missing,0,'no dropped audible samples at scheduled boundaries');
  console.log('✓ Actual Web Audio render: streamed PCM matches a continuous waveform without gaps');
}finally{await browser.close();}

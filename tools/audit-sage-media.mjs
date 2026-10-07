// Production file viewer, tool routing and HTMLMediaElement playback with fixture files.
// No account, provider call, stored user file or database mutation.
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
let chromium;
try{({chromium}=await import('playwright'));}catch{({chromium}=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs'))));}
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const source=await readFile(path.join(root,'src/js/script.js'),'utf8');
const start=source.indexOf('(function () {',source.indexOf('// RECORD HISTORY — MEDIA PLAYER'));
const end=source.indexOf('\n})();',start)+7;
const first=source.indexOf('    async openStoredFile('),last=source.indexOf('    async navigateHistory(',first);
const list=source.indexOf('    async listDocuments('),listEnd=source.indexOf('    async listParkHistory(',list);
assert.ok(start>0&&end>start&&first>0&&list>0);
const fixture=`window.dkReduceMotion=()=>true; window.SageVoice={minimize(){window.docked=true;const el=document.getElementById('sageVoiceOverlay');el.hidden=false;el.setAttribute('aria-hidden','false');el.classList.add('is-docked');el.style.left=(innerWidth-156)+'px';el.style.top=(innerHeight-196)+'px';return true;},avoidMediaControls(){document.getElementById('sageVoiceOverlay').style.top=(innerHeight-340)+'px';}};
window._historicMediaRows=new Map([[1,{id:1,media_type:'video',file_name:'clip.wav',original_name:'Ride clip',upload_date:'2026-10-07'}],[2,{id:2,media_type:'image',file_name:'photo.svg',original_name:'Bike photo',upload_date:'2026-10-06'}]]);
window._vehicleDocRows=new Map([['Driving License',{fileName:'license.pdf',origName:'Licence.pdf'}]]);
window.dkGetHistoricMediaUrl=async file=>'/fixtures/'+file;window.dkGetVehicleDocumentUrl=async()=>'/fixtures/license.pdf';
window.dkDocsPager={reveal(el){el.classList.remove('is-paged-out');}};
async function ensureDocsLoaded(){};function getHistoricLocalNote(){return null;}
window.dkApp={async goToSection(){document.getElementById('docs').classList.add('active');return {ok:true};},${source.slice(list,listEnd)} ${source.slice(first,last)}};
${source.slice(start,end)}
`;
const wav=Buffer.alloc(44+16000*4);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);for(let i=0;i<32000;i++)wav.writeInt16LE(Math.round(Math.sin(2*Math.PI*220*i/16000)*1000),44+i*2);
const server=http.createServer(async(req,res)=>{
 const url=req.url.split('?')[0];
 if(url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(fixture);return;}
 if(url==='/fixtures/clip.wav'){res.setHeader('Content-Type','audio/wav');res.end(wav);return;}
 if(url==='/fixtures/photo.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="orange"/></svg>');return;}
 if(url==='/fixtures/license.pdf'){res.setHeader('Content-Type','application/pdf');res.end('%PDF-1.4\n% fixture');return;}
 const file=path.resolve(root,url.replace(/^\//,'')||'index.html');if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{
  let data=await readFile(file);
  if(url==='/')data=data.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>',
  ['sage-page-controls','sage-tools','sage-ai'].map(n=>`<script src="src/js/${n}.js"></script>`).join('')+'<script src="/fixture.js"></script></body>');
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'text/html');res.end(data);
 }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());await page.goto(base);
 await page.evaluate(()=>{
  document.getElementById('docs').classList.add('active');
  document.querySelector('#mediaRecordTable tbody').innerHTML='<tr class="docs-media-row is-paged-out" data-media-id="1"><td>Ride clip</td></tr><tr class="docs-media-row" data-media-id="2"><td>Bike photo</td></tr>';
  document.querySelector('.vehicle-docs-grid').innerHTML='<div class="doc-card" data-type="Driving License"><button class="doc-open-pill">View</button></div>';
  const unlock=document.createElement('button');unlock.id='auditUnlock';unlock.textContent='Unlock playback';document.body.append(unlock);
 });
 await page.click('#auditUnlock');
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  let reply=await page.evaluate(()=>SageAI.askSage('Play the last saved archive video.',{voice:true}));
  assert.equal(reply.text,'Playing Ride clip.');
  assert.equal(await page.evaluate(()=>document.querySelector('#docsPlayer .dkp-media').paused),false);
  assert.equal(await page.evaluate(()=>window.docked),true);
  assert.equal(await page.locator('#sageVoiceOrb').evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('#sageVoiceOrb')===el;}),true,'orb stays clickable above the file viewer');
  await mkdir('/tmp/sage-media-preview',{recursive:true});
  await page.screenshot({path:`/tmp/sage-media-preview/${viewport.width}-video.png`});
  assert.equal(await page.evaluate(()=>document.querySelector('tr[data-media-id="1"]').classList.contains('is-paged-out')),false);
  reply=await page.evaluate(()=>SageAI.askSage('pause video',{voice:true}));assert.equal(reply.text,'Paused.');
  assert.equal(await page.evaluate(()=>document.querySelector('#docsPlayer .dkp-media').paused),true);
  reply=await page.evaluate(()=>SageAI.askSage('close file viewer',{voice:true}));assert.match(reply.text,/Closed/);
  reply=await page.evaluate(()=>SageAI.askSage('Open my driver\'s license.',{voice:true}));assert.equal(reply.text,'Opened Driving License.');
  assert.match(await page.locator('#docsPlayer iframe').getAttribute('src'),/license.pdf/);
  await page.evaluate(()=>dkMediaPlayer.control('close'));
  reply=await page.evaluate(()=>SageAI.askSage('show the latest photo',{voice:true}));assert.equal(reply.text,'Opened Bike photo.');
  await page.waitForFunction(()=>document.querySelector('#docsPlayer img')?.naturalWidth===300);
  await page.evaluate(()=>dkMediaPlayer.control('close'));
 }
 // A play() rejection must leave the file visible and report the required user gesture.
 const blocked=await page.evaluate(async()=>{
  const original=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=()=>Promise.reject(new DOMException('Blocked','NotAllowedError'));
  try{return await SageAI.askSage('play the latest video',{voice:true});}finally{HTMLMediaElement.prototype.play=original;}
 });
 assert.match(blocked.text,/one tap on Play/);assert.equal(await page.evaluate(()=>document.querySelector('#docsPlayer .dkp-media').paused),true);
 await page.evaluate(()=>dkMediaPlayer.control('close'));
 // Cancelling a signed URL request cannot open late or mutate a newer viewer.
 const cancelled=await page.evaluate(async()=>{
  let resolve,cancel=false;window.dkGetHistoricMediaUrl=()=>new Promise(r=>{resolve=r;});
  const pending=dkMediaPlayer.openStored({kind:'media',id:'1',isCancelled:()=>cancel});
  await new Promise(r=>setTimeout(r,30));cancel=true;resolve('/fixtures/clip.wav');return await pending;
 });
 assert.equal(cancelled.ok,false);assert.equal(await page.locator('#docsPlayer').getAttribute('aria-hidden'),'true');
 assert.deepEqual(errors,[]);console.log('PASS: production viewer opens documents/images, plays actual media, pauses, reveals off-page files, handles autoplay refusal and cancels stale signing on desktop/mobile.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}

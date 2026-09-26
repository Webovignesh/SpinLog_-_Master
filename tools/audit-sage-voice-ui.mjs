// Render the actual Sage markup/styles with isolated, deterministic voice mocks.
// No external requests, API keys, or database writes. Requires Playwright.
// PLAYWRIGHT_CHROMIUM_EXECUTABLE can point at an existing Chromium binary.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw new Error('Install playwright to run the voice UI audit.');
  ({ chromium } = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href));
}
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url))); 
const output = process.env.SAGE_SCREENSHOT_DIR || '/tmp/sage-voice-preview';
await mkdir(output, { recursive: true });
const server = http.createServer(async (req,res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const filename = path.resolve(root,rel);
  if (!filename.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try {
    let content = await readFile(filename);
    if (rel === 'index.html') content = content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
      .replace('</body>','<script src="src/js/sage-voice.js"></script></body>');
    res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.webp':'image/webp'})[path.extname(filename)] || 'application/octet-stream');
    res.end(content);
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', err => errors.push(err.message));
  await page.route('**/*',route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await page.addInitScript(() => {
    let history = [];
    window.dkCloudStore = {chatHistory:()=>history.slice(),setChat:rows=>history=rows};
    window.SageAI = {availableKeys:()=>[{key:'test-only'}],askSage:async()=>({ok:true,text:'சரி bro, உன் Duke-க்கு next service எப்போன்னு பார்க்கலாம். Last service reading சொல்லு.'})};
    window.fetch = async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{inlineData:{data:'AAAAAA=='}}]}}]})});
    window.Audio = class {play(){setTimeout(()=>this.onended?.(),1);return Promise.resolve()} pause(){} removeAttribute(){}};
    window.SpeechRecognition = class {start(){} abort(){} stop(){}};
    localStorage.setItem('sage_voice_recognition','browser');
  });
  for (const [name,width,height] of [['desktop',1280,900],['mobile',390,844],['small',320,568]]) {
    await page.setViewportSize({width,height});
    await page.goto(base, {waitUntil:'domcontentloaded'});
    await page.evaluate(()=>{
      document.querySelectorAll('main section').forEach(s=>s.classList.toggle('active',s.id==='sage'));
      document.querySelector('#sage').style.display='block';
    });
    await page.locator('#sageChatMic').click();
    await page.evaluate(async()=>{
      await SageVoice.sendVoiceText('Bro, நேத்து petrol போட்டேன்.');
      await SageVoice.sendVoiceText('அடுத்த service எப்போ பண்ணணும்?');
      await SageVoice.sendVoiceText('Mileage கொஞ்சம் குறையுது போல.');
    });
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#sageVoiceLines > p').count(),4);
    const bounds = await page.locator('.sage-voice-card').boundingBox();
    assert.ok(bounds.x >= -1 && bounds.y >= -1 && bounds.x+bounds.width <= width+1 && bounds.y+bounds.height <= height+1, `${name}: card fits screen`);
    for (const selector of ['#sageVoiceEnd','#sageVoiceMic','#sageVoiceClose']) {
      const b = await page.locator(selector).boundingBox();
      assert.ok(b.y >= 0 && b.y+b.height <= height,`${name}: ${selector} visible`);
    }
    await page.screenshot({path:path.join(output,`sage-voice-${name}.png`)});
    await page.locator('#sageVoiceEnd').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'sageVoiceClose');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>SageVoice.isOpen()),false);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'sageChatMic');
    await page.waitForTimeout(300);
    await page.screenshot({path:path.join(output,`sage-chat-${name}.png`)});
    await page.evaluate(()=>{
      const modal=document.getElementById('sageSettingsModal');modal.classList.add('sl-modal--open');modal.setAttribute('aria-hidden','false');
      document.querySelectorAll('.sage-set-panel').forEach(p=>{p.hidden=p.id!=='sagePanelVoice';p.classList.toggle('is-on',!p.hidden)});
      document.querySelectorAll('.sage-set-tab').forEach(p=>p.classList.toggle('is-on',p.id==='sageTabVoice'));
    });
    await page.waitForTimeout(300);
    const font = await page.locator('#sageListeningTitle').evaluate(el=>getComputedStyle(el).fontFamily);
    assert.ok(!/Blender|Oswald/.test(font),'settings use readable font');
    await page.screenshot({path:path.join(output,`sage-settings-${name}.png`)});
    console.log(`✓ ${name}: four turns, viewport, controls, keyboard focus and settings font`);
  }
  assert.deepEqual(errors,[]);
  console.log(`✓ No voice UI runtime errors. Screenshots: ${output}`);
} finally { await browser?.close(); server.close(); }

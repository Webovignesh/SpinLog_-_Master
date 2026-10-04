// Verify the real AudioWorklet processor across render blocks and sample rates.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/js/sage-pcm-worklet.js',import.meta.url),'utf8');
for(const rate of [16000,44100,48000]) {
  test(`PCM worklet preserves onset, duration and packet continuity at ${rate} Hz`,()=>{
    const packets=[];let Ctor;
    class Processor {port={postMessage:m=>packets.push(m)};}
    vm.runInNewContext(source,{AudioWorkletProcessor:Processor,sampleRate:rate,Int16Array,
      registerProcessor:(_name,value)=>{Ctor=value;}});
    const p=new Ctor(),duration=.537,input=new Float32Array(Math.round(rate*duration));
    for(let i=0;i<input.length;i++)input[i]=.2*Math.sin(2*Math.PI*220*i/rate);
    // A short first word begins in the very first render block.
    input[0]=.5;
    for(let i=0;i<input.length;i+=128)p.process([[input.subarray(i,i+128)]]);
    p.port.onmessage({data:'flush'});
    const audio=packets.filter(m=>m.pcm),samples=audio.flatMap(m=>Array.from(new Int16Array(m.pcm)));
    assert.ok(Math.abs(samples.length-input.length*16000/rate)<1);
    assert.ok(samples[0]>1000,'the first sample is retained');
    assert.ok(audio.slice(0,-1).every(m=>m.pcm.byteLength===3200),'100 ms packets');
    let error=0;
    for(let i=1;i<samples.length;i++)error+=Math.abs(samples[i]/32768-.2*Math.sin(2*Math.PI*220*(i+.5)/16000));
    assert.ok(error/samples.length<.009,'no dropped/repeated samples or frame-boundary clicks');
    assert.equal(packets.at(-1).flushed,true);
  });
}

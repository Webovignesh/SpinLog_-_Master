// Continuous 16 kHz mono PCM, 100 ms packets. Fractional integration preserves
// sample continuity across 44.1/48 kHz render blocks and low-pass downsamples.
import {createSpeechDetector} from '../../vendor/sage-vad.js?v=1.9.40';
class SagePCMCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.samples = new Int16Array(1600); this.offset = 0;
    this.weight = 0; this.sum = 0; this.energy = 0; this.peak = 0;
    this.ratio = sampleRate / 16000;
    this.vadFrame = new Int16Array(320); this.vadOffset = 0; this.vadEnergy = 0;
    this.speechMs = 0; this.activeMs = 0;
    try { this.vad = createSpeechDetector(); } catch { this.vad = null; }
    this.port.onmessage = event => {
      if (event.data === 'flush') { this.flush(); this.port.postMessage({flushed:true}); }
      if (event.data === 'close') { this.vad?.close(); this.vad = null; }
    };
  }
  flush() {
    if (!this.offset) return;
    const pcm = this.samples.slice(0,this.offset).buffer;
    this.port.postMessage({pcm,rms:Math.sqrt(this.energy/this.offset),peak:this.peak,
      speechMs:this.vad ? this.speechMs : null,activeMs:this.activeMs},[pcm]);
    this.offset = 0; this.energy = 0; this.peak = 0; this.speechMs = 0; this.activeMs = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      let remaining = 1;
      while (remaining > 1e-8) {
        const part = Math.min(remaining, this.ratio - this.weight);
        this.sum += sample * part; this.weight += part; remaining -= part;
        if (this.weight >= this.ratio - 1e-8) {
          const value = Math.max(-1,Math.min(1,this.sum/this.ratio));
          const pcm = Math.round(value * (value < 0 ? 32768 : 32767));
          this.samples[this.offset++] = pcm;
          this.vadFrame[this.vadOffset++] = pcm; this.vadEnergy += value * value;
          if (this.vadOffset === 320) {
            const audible = Math.sqrt(this.vadEnergy / 320) > 0.003;
            if (audible) this.activeMs += 20;
            // Ignore the detector's internal hangover on energy-free frames.
            try { if (this.vad?.process(this.vadFrame) && audible) this.speechMs += 20; }
            catch { this.vad?.close(); this.vad = null; }
            this.vadOffset = 0; this.vadEnergy = 0;
          }
          this.energy += value * value; this.peak = Math.max(this.peak,Math.abs(value));
          this.sum = 0; this.weight = 0;
          if (this.offset === this.samples.length) this.flush();
        }
      }
    }
    return true;
  }
}
registerProcessor('sage-pcm-capture', SagePCMCapture);

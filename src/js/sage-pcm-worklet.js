// Continuous 16 kHz mono PCM, 100 ms packets. Fractional integration preserves
// sample continuity across 44.1/48 kHz render blocks and low-pass downsamples.
class SagePCMCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.samples = new Int16Array(1600); this.offset = 0;
    this.weight = 0; this.sum = 0; this.energy = 0; this.peak = 0;
    this.ratio = sampleRate / 16000;
    this.port.onmessage = event => { if (event.data === 'flush') { this.flush(); this.port.postMessage({flushed:true}); } };
  }
  flush() {
    if (!this.offset) return;
    const pcm = this.samples.slice(0,this.offset).buffer;
    this.port.postMessage({pcm,rms:Math.sqrt(this.energy/this.offset),peak:this.peak},[pcm]);
    this.offset = 0; this.energy = 0; this.peak = 0;
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
          this.samples[this.offset++] = Math.round(value * (value < 0 ? 32768 : 32767));
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

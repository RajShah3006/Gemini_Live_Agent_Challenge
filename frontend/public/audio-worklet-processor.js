/**
 * AudioWorklet processor for capturing PCM audio.
 * Runs on the audio rendering thread for glitch-free capture.
 * Captures 16-bit PCM at the AudioContext's sample rate (16kHz).
 */
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 4096; // ~256ms at 16kHz
    this._maxBufferSize = 64000; // ~4s at 16kHz — drop oldest if backpressured
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    for (let i = 0; i < channelData.length; i++) {
      this._buffer.push(channelData[i]);
    }

    // Prevent unbounded memory growth under backpressure
    if (this._buffer.length > this._maxBufferSize) {
      this._buffer.splice(0, this._buffer.length - this._bufferSize);
    }

    // Once we have enough samples, send the chunk
    if (this._buffer.length >= this._bufferSize) {
      const float32 = new Float32Array(this._buffer.splice(0, this._bufferSize));
      // Convert Float32 to Int16 PCM
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      // Send as ArrayBuffer (transferred for zero-copy)
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-capture-processor", PCMCaptureProcessor);

import { StateManager } from "./state_manager.js";

class NimioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this.stateManager = new StateManager(options.processorOptions.sab);
    this.sampleRate = options.processorOptions.sampleRate;
    this.channelCount = options.outputChannelCount[0];

    this.targetLatencyMs = options.processorOptions.latency;
    this.hysteresis = this.targetLatencyMs < 1000 ? 1.5 : 1;
    this.blankProcessing = options.processorOptions.blank;
    this.playbackStartTs = 0;

    const bufferSec = Math.ceil(
      (this.targetLatencyMs +
        options.processorOptions.startOffset +
        options.processorOptions.pauseTimeout +
        200) /
        1000,
    ); // 200 overhead for fast audio

    this.bufferSize = this.sampleRate * this.channelCount * bufferSec;
    this.ringBuffer = new Float32Array(this.bufferSize);
    this.readIndex = this.writeIndex = this.available = 0;
    this.startThreshold =
      (this.sampleRate * this.channelCount * this.targetLatencyMs) / 1000;
    this.speedFactor = 1.0;

    this.port.onmessage = ({ data }) => {
      const chunk = new Float32Array(data.buffer);
      let curIdx = this.writeIndex;
      for (let i = 0; i < chunk.length; i++) {
        if (this.readIndex === curIdx && this.available > 0) {
          console.error("audio buffer overflow", this.readIndex, curIdx);
        }
        this.ringBuffer[curIdx++] = chunk[i];
        if (curIdx === this.bufferSize) curIdx = 0;
      }
      this.writeIndex = curIdx;
      this.available += chunk.length;
      if (this.available > this.bufferSize) this.available = this.bufferSize;
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const chCnt = out.length;
    const smplCnt = out[0].length;
    const speed = this.speedFactor;

    if (this.stateManager.isStopped()) {
      return false; // stop processing
    }

    const durationUs = (smplCnt * 1e6) / this.sampleRate;
    if (this.blankProcessing) {
      this._insertSilence(out, chCnt);
      if (this.playbackStartTs === 0) {
        this.playbackStartTs = this.stateManager.getPlaybackStartTsUs();
      }
      if (this.playbackStartTs !== 0) {
        this.available += smplCnt * chCnt * speed;
        if (this.available >= this.startThreshold) {
          let curTs = this.stateManager.incCurrentTsUs(durationUs * speed);
          curTs += this.playbackStartTs;
          let availableMs = (this.stateManager.getVideoLatestTsUs() - curTs) / 1000;
          this._controlPlaybackLatency(availableMs);
        }
      }
      return true;
    }

    if (
      this.stateManager.isPaused() ||
      this.available < smplCnt * chCnt * speed ||
      this.available < this.startThreshold
    ) {
      this._insertSilence(out, chCnt);
      console.debug("Insert silence: ", durationUs);
      this.stateManager.incSilenceMs(durationUs / 1000);
    } else {
      this.startThreshold = 0;
      this.stateManager.incCurrentTsUs(durationUs * speed);

      for (let c = 0; c < chCnt; c++) {
        const channelData = out[c];
        for (let i = 0; i < smplCnt; i++) {
          // nearest "skipped" sample
          const srcSample = (i * speed) | 0;
          let idx = this.readIndex + srcSample * chCnt + c;
          if (idx >= this.bufferSize) {
            idx -= this.bufferSize;
          }
          channelData[i] = this.ringBuffer[idx];
        }
      }

      const consumedSamples = (smplCnt * speed) | 0;
      this.readIndex = this.readIndex + consumedSamples * chCnt;
      if (this.readIndex >= this.bufferSize) {
        this.readIndex -= this.bufferSize;
      }
      this.available -= consumedSamples * chCnt;

      this._controlPlaybackLatency(
        (this.available / (this.sampleRate * this.channelCount)) * 1000
      );
    }
    return true;
  }

  _insertSilence(out, chCnt) {
    for (let c = 0; c < chCnt; c++) {
      out[c].fill(0);
    }
  }

  _controlPlaybackLatency (availableMs) {
    if (availableMs <= this.targetLatencyMs) {
      if (this.speedFactor !== 1.0) {
        this.speedFactor = 1.0;
        console.debug('speedFactor 1.0', availableMs, this.targetLatencyMs);
      }
    } else if (availableMs > this.targetLatencyMs * this.hysteresis) {
      if (this.speedFactor !== 1.1) {
        this.speedFactor = 1.1; // speed boost
        console.debug('speedFactor 1.1', availableMs, this.targetLatencyMs);
      }
    }
    this.stateManager.setAvailableAudioSec(availableMs);
  }
}

registerProcessor("nimio-processor", NimioProcessor);

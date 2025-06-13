import { StateManager } from "./state-manager.js";
import { ReadableAudioBuffer } from "./media/buffers/readable-audio-buffer.js";

class NimioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this.stateManager = new StateManager(options.processorOptions.stateSab);
    this.sampleRate = options.processorOptions.sampleRate;
    this.channelCount = options.outputChannelCount[0];
    this.fSampleCount = options.processorOptions.sampleCount;
    // this.totalSampleRate = this.sampleRate * this.channelCount;

    this.targetLatencyMs = options.processorOptions.latency;
    this.hysteresis = this.targetLatencyMs < 1000 ? 1.5 : 1;
    this.idle = options.processorOptions.idle;
    this.playbackStartTs = 0;

    if (!this.idle) {
      this.audioBuffer = new ReadableAudioBuffer(
        options.processorOptions.audioSab,
        options.processorOptions.capacity,
        this.channelCount,
        this.fSampleCount,
      );
    }

    this.available = 0;
    this.startThreshold = this.targetLatencyMs * this.sampleRate / 1000;
    this.speedFactor = 1.0;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const chCnt = out.length;
    const smplCnt = out[0].length;
    const speed = this.speedFactor;

    if (this.stateManager.isStopped()) {
      return false; // stop processing
    }

    const durationNs = ((smplCnt * speed * 1e9) / this.sampleRate + 0.5) >>> 0;
    if (this.idle) {
      return this._processIdle(out, chCnt, smplCnt, speed, durationNs);
    }

    this.available = this.audioBuffer.getSize() * this.fSampleCount;
    if (
      this.stateManager.isPaused() ||
      this.available < smplCnt * speed ||
      this.available < this.startThreshold
    ) {
      this._insertSilence(out, chCnt);
      console.debug("Insert silence: ", durationNs);
      // TODO: use 64-bit value for storing silence duration
      this.stateManager.incSilenceUs((durationNs / 1000 + 0.5) >>> 0);
    } else {
      this.startThreshold = 0;
      this.stateManager.incCurrentTsNs(durationNs);

      // for (let c = 0; c < chCnt; c++) {
      //   const channelData = out[c];
      //   for (let i = 0; i < smplCnt; i++) {
      //     // nearest "skipped" sample
      //     const srcSample = (i * speed) | 0;
      //     let idx = this.readIndex + srcSample * chCnt + c;
      //     if (idx >= this.bufferSize) {
      //       idx -= this.bufferSize;
      //     }
      //     channelData[i] = this.ringBuffer[idx];
      //   }
      // }
      for (let i = 0; i < smplCnt; i++) {
        const offset = (i * speed) | 0;
        out[0][i] = this.ringBuffer[this.readIndex + offset];
        out[1][i] = this.ringBuffer2[this.readIndex + offset];
      }

      const consumedSamples = (smplCnt * speed) | 0;
      // this.readIndex = this.readIndex + consumedSamples * chCnt;
      this.readIndex += consumedSamples;
      if (this.readIndex >= this.bufferSize) {
        this.readIndex -= this.bufferSize;
      }

      this.available -= consumedSamples;

      this._controlPlaybackLatency(1000 * this.available / this.sampleRate);
    }
    return true;
  }

  _processIdle(output, channelCount, smplCnt, speed, durationNs) {
    this._insertSilence(output, channelCount);
    if (this.stateManager.isPaused()) return true;

    if (this.playbackStartTs === 0) {
      this.playbackStartTs = this.stateManager.getPlaybackStartTsUs();
    }
    if (this.playbackStartTs !== 0) {
      if (this.available < this.startThreshold) {
        this.available += smplCnt * speed;
      }

      if (this.available >= this.startThreshold) {
        this.available = this.startThreshold;
        let curTs = this.stateManager.incCurrentTsNs(durationNs) / 1000;
        curTs += this.playbackStartTs;
        let availableMs = (this.stateManager.getVideoLatestTsUs() - curTs) / 1000;
        this._controlPlaybackLatency(availableMs);
      }
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
    if (!this.idle) {
      this.stateManager.setAvailableAudioMs((availableMs + 0.5) >>> 0);
    }
  }
}

registerProcessor("nimio-processor", NimioProcessor);

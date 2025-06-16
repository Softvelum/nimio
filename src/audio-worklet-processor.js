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
    this.hysteresis = this.targetLatencyMs < 1000 ? 1.5 : 1.2;
    this.idle = options.processorOptions.idle;
    this.playbackStartTs = 0;

    if (!this.idle) {
      this.audioBuffer = new ReadableAudioBuffer(
        options.processorOptions.audioSab,
        options.processorOptions.capacity,
        this.sampleRate,
        this.channelCount,
        this.fSampleCount,
      );
    }

    this._totalDurationFloatNs = 0;

    this.available = 0;
    this.startThreshold = this.targetLatencyMs * 1000;
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

    if (this.playbackStartTs === 0) {
      this.playbackStartTs = this.stateManager.getPlaybackStartTsUs();
    }

    const durationFloatNs = (smplCnt * speed * 1e9) / this.sampleRate;
    if (this.idle) {
      return this._processIdle(out, chCnt, smplCnt, speed, durationFloatNs);
    }

    let curTsUs = this.stateManager.getCurrentTsNs() / 1000 + this.playbackStartTs;
    this.available = this.audioBuffer.getLastTimestamp() - curTsUs;
    if (this.available < 0) this.available = 0;

    if (
      this.stateManager.isPaused() ||
      this.startThreshold > 0 && this.available < this.startThreshold
    ) {
      this._insertSilence(out, chCnt);
      const durationMs = (durationFloatNs / 1000 + 0.5) >>> 0;
      console.debug("Insert silence: ", durationMs);
      // TODO: use 64-bit value for storing silence duration
      this.stateManager.incSilenceUs(durationMs);
    } else {
      this.startThreshold = 0;
      let curTsNs = this._incrementTsNs(durationFloatNs);
      curTsNs += this.playbackStartTs * 1000;
      const durationNs = (durationFloatNs + 0.5) >>> 0;
      this.audioBuffer.read(curTsNs - durationNs, curTsNs, out, speed);

      this.available -= durationFloatNs / 1000;
      if (this.available < 0) this.available = 0;

      this._controlPlaybackLatency(this.available / 1000);
    }
    return true;
  }

  _processIdle(output, channelCount, smplCnt, speed, durationFloatNs) {
    this._insertSilence(output, channelCount);
    if (this.stateManager.isPaused()) return true;

    if (this.playbackStartTs !== 0) {
      if (this.available < this.startThreshold) {
        this.available += (smplCnt * speed * 1e6) / this.sampleRate;
      }

      if (this.available >= this.startThreshold) {
        this.available = this.startThreshold;
        let curTs = this._incrementTsNs(durationFloatNs) / 1000;
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

  _incrementTsNs(durationFloatNs) {
    this._totalDurationFloatNs += durationFloatNs;
    let res = this.stateManager.incCurrentTsNs((durationFloatNs + 0.5) >>> 0);
    let diff = res > this._totalDurationFloatNs ?
      res - this._totalDurationFloatNs : this._totalDurationFloatNs - res;

    if (diff >= 2000) { // fix 2 us inaccuracy
      console.log('fix current ts ns', diff);
      res = Math.round(this._totalDurationFloatNs);
      this.stateManager.setCurrentTsNs(res);
    }
    return res;
  }
}

registerProcessor("nimio-processor", NimioProcessor);

import { StateManager } from "./state-manager.js";

class NimioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this.stateManager = new StateManager(options.processorOptions.sab);
    this.sampleRate = options.processorOptions.sampleRate;
    this.channelCount = options.outputChannelCount[0];

    this.targetLatencyMs = options.processorOptions.latency;
    this.hysteresis = this.targetLatencyMs < 1000 ? 1.5 : 1;
    this.idle = options.processorOptions.idle;
    this.playbackStartTs = 0;

    const bufferSec = Math.ceil(
      (this.targetLatencyMs +
        options.processorOptions.startOffset +
        options.processorOptions.pauseTimeout +
        200) /
        1000,
    ); // 200 overhead for fast audio

    this.totalSampleRate = this.sampleRate * this.channelCount;
    this.bufferSize = this.totalSampleRate * bufferSec;
    this.ringBuffer = new Float32Array(this.bufferSize);
    this.ringBuffer2 = new Float32Array(this.bufferSize);
    this.readIndex = this.writeIndex = this.available = 0;
    this.startThreshold = this.totalSampleRate * this.targetLatencyMs / 1000;
    this.speedFactor = 1.0;

    this.port.onmessage = ({ data }) => {
      const chunk = new Float32Array(data.frame);
      let curIdx = this.writeIndex;
      let sampleCount = chunk.length / this.channelCount;
      for (let i = 0; i < sampleCount; i++) {
        if (this.readIndex === curIdx && this.available > 0) {
          console.error("audio buffer overflow", this.readIndex, curIdx);
        }
        this.ringBuffer[curIdx] = chunk[i];
        this.ringBuffer2[curIdx] = chunk[i + sampleCount];
        curIdx++;
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

    const durationNs = ((smplCnt * speed * 1e9) / this.sampleRate + 0.5) >>> 0;
    if (this.idle) {
      return this._processIdle(out, chCnt, smplCnt, speed, durationNs);
    }

    if (
      this.stateManager.isPaused() ||
      this.available < smplCnt * chCnt * speed ||
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
      this.available -= consumedSamples * chCnt;

      this._controlPlaybackLatency(1000 * this.available / this.totalSampleRate);
    }
    return true;
  }

  _processIdle(output, channelCount, sampleCount, speed, durationNs) {
    this._insertSilence(output, channelCount);
    if (this.stateManager.isPaused()) return true;

    if (this.playbackStartTs === 0) {
      this.playbackStartTs = this.stateManager.getPlaybackStartTsUs();
    }
    if (this.playbackStartTs !== 0) {
      this.available += sampleCount * channelCount * speed;
      if (this.available >= this.startThreshold) {
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

import { StateManager } from "@/state-manager";
import { ReadableAudioBuffer } from "@/media/buffers/readable-audio-buffer";
import { AudioConfig } from "./config";
import { LoggersFactory } from "@/shared/logger";

class AudioNimioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    LoggersFactory.setLevel(options.processorOptions.logLevel);
    LoggersFactory.toggleWorkletLogs(options.processorOptions.enableLogs);
    this._logger = LoggersFactory.create(
      options.processorOptions.instanceName,
      "AudioNimioProcessor",
      this.port,
    );

    this.stateManager = new StateManager(options.processorOptions.stateSab);
    this.sampleRate = options.processorOptions.sampleRate;
    this.channelCount = options.outputChannelCount[0];
    this.fSampleCount = options.processorOptions.sampleCount;
    this._audioConfig = new AudioConfig(
      this.sampleRate,
      this.channelCount,
      this.fSampleCount,
    );

    this.targetLatencyMs = options.processorOptions.latency;
    this.hysteresis = this.targetLatencyMs < 1000 ? 1.5 : 1.2;
    this.idle = options.processorOptions.idle;
    this.playbackStartTsUs = 0;

    if (!this.idle) {
      this.audioBuffer = new ReadableAudioBuffer(
        options.processorOptions.audioSab,
        options.processorOptions.capacity,
        this.sampleRate,
        this.channelCount,
        this.fSampleCount,
      );
    }

    this.available = 0;
    this.startThreshold = this.targetLatencyMs * 1000;
    this.minThreshold = 0.25 * this.startThreshold;
    this.speedFactor = 1.0;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const chCnt = out.length;
    const speed = this.speedFactor;

    if (this.stateManager.isStopped()) {
      return false; // stop processing
    }

    if (this.playbackStartTsUs === 0) {
      this.playbackStartTsUs = this.stateManager.getPlaybackStartTsUs();
    }

    const sampleCount = (out[0].length * speed + 0.5) >>> 0;
    if (this.idle) {
      return this._processIdle(out, chCnt, sampleCount);
    }

    let curSmpCnt = this.stateManager.getCurrentTsSmp();
    let curTsUs =
      this._audioConfig.smpCntToTsUs(curSmpCnt) + this.playbackStartTsUs;
    this.available = this.audioBuffer.getLastTimestampUs() - curTsUs;
    // this._logger.debug(`available=${this.available} curTsUs=${curTsUs}, playbackStartTsUs=${this.playbackStartTsUs}, curSmpCnt=${curSmpCnt}, lastTsUs=${this.audioBuffer.getLastTimestampUs()}`);
    if (this.available < 0) this.available = 0;

    if (
      this.stateManager.isPaused() ||
      this.available < this.minThreshold ||
      (this.startThreshold > 0 && this.available < this.startThreshold)
    ) {
      this._insertSilence(out, chCnt);
      const durationMs = ((1e6 * sampleCount) / this.sampleRate + 0.5) >>> 0;
      this._logger.debug("Insert silence: ", durationMs);
      // TODO: use 64-bit value for storing silence duration
      this.stateManager.incSilenceUs(durationMs);
    } else {
      this.startThreshold = 0;
      let incTsUs = this._incrementCurTs(sampleCount);
      this.audioBuffer.read(curTsUs * 1000, incTsUs * 1000, out, speed);

      this._controlPlaybackLatency(this.available / 1000);
    }
    return true;
  }

  _processIdle(output, channelCount, sampleCount) {
    this._insertSilence(output, channelCount);
    if (this.stateManager.isPaused()) return true;

    if (this.playbackStartTsUs !== 0) {
      if (this.available < this.startThreshold) {
        this.available += (sampleCount * 1e6) / this.sampleRate;
      }

      if (this.available >= this.startThreshold) {
        this.available = this.startThreshold;
        let curTsUs = this._incrementCurTs(sampleCount);
        let availableMs =
          (this.stateManager.getVideoLatestTsUs() - curTsUs) / 1000;
        this._controlPlaybackLatency(availableMs);
      }
    }

    return true;
  }

  _incrementCurTs(sampleCount) {
    let curSmpCnt = this.stateManager.incCurrentTsSmp(sampleCount);
    return this._audioConfig.smpCntToTsUs(curSmpCnt) + this.playbackStartTsUs;
  }

  _insertSilence(out, chCnt) {
    for (let c = 0; c < chCnt; c++) {
      out[c].fill(0);
    }
  }

  _controlPlaybackLatency(availableMs) {
    if (availableMs <= this.targetLatencyMs) {
      if (this.speedFactor !== 1.0) {
        this.speedFactor = 1.0;
        console.debug("speedFactor 1.0", availableMs, this.targetLatencyMs);
      }
    } else if (availableMs > this.targetLatencyMs * this.hysteresis) {
      if (this.speedFactor !== 1.1) {
        this.speedFactor = 1.1; // speed boost
        console.debug("speedFactor 1.1", availableMs, this.targetLatencyMs);
      }
    }
    if (!this.idle) {
      this.stateManager.setAvailableAudioMs((availableMs + 0.5) >>> 0);
    }
  }
}

registerProcessor("audio-nimio-processor", AudioNimioProcessor);

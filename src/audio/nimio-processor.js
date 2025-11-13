import { StateManager } from "@/state-manager";
import { ReadableAudioBuffer } from "@/media/buffers/readable-audio-buffer";
import { AudioConfig } from "./config";
import { LoggersFactory } from "@/shared/logger";
import { LatencyController } from "@/latency-controller";

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

    this._stateManager = new StateManager(options.processorOptions.stateSab);
    this._sampleRate = options.processorOptions.sampleRate;
    this._channelCount = options.outputChannelCount[0];
    this._fSampleCount = options.processorOptions.sampleCount;
    this._audioConfig = new AudioConfig(
      this._sampleRate,
      this._channelCount,
      this._fSampleCount,
    );

    this._idle = options.processorOptions.idle;
    this._targetLatencyMs = options.processorOptions.latency;
    this._latencyCtrl = new LatencyController(
      options.processorOptions.instanceName,
      this._stateManager,
      this._audioConfig,
      {
        latency: this._targetLatencyMs,
        video: options.processorOptions.videoEnabled,
        audio: !this._idle,
        port: this.port,
      },
    );
    this._latencyCtrl.speedFn = this._setSpeed.bind(this);

    if (!this._idle) {
      this._audioBuffer = new ReadableAudioBuffer(
        options.processorOptions.audioSab,
        options.processorOptions.capacity,
        this._sampleRate,
        this._channelCount,
        this._fSampleCount,
      );
    }

    this._speed = 1.0;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const chCnt = out.length;

    if (this._stateManager.isStopped()) {
      return false; // stop processing
    }

    const sampleCount = (out[0].length * this._speed + 0.5) >>> 0;
    if (this._stateManager.isPaused()) {
      this._insertSilence(out, chCnt, sampleCount);
      return true;
    }

    let curTsUs = this._latencyCtrl.incAudioSamples(sampleCount);
    if (this._idle || this._latencyCtrl.isPending()) {
      this._insertSilence(out, chCnt, sampleCount);
    } else {
      let incTsUs = curTsUs + this._audioConfig.smpCntToTsUs(sampleCount);
      this._audioBuffer.read(curTsUs * 1000, incTsUs * 1000, out, this._speed);
    }

    return true;
  }

  _insertSilence(out, chCnt, sampleCount) {
    for (let c = 0; c < chCnt; c++) {
      out[c].fill(0);
    }

    if (!this._idle) {
      this._stateManager.incSilenceUs(this._samplesDurationUs(sampleCount));
    }
  }

  _samplesDurationUs(sampleCount) {
    return (this._audioConfig.smpCntToTsUs(sampleCount) + 0.5) >>> 0;
  }

  _setSpeed(speed, availableMs) {
    if (this._speed === speed) return;
    this._speed = speed;
    this._logger.debug(`speed ${speed}`, availableMs, this._targetLatencyMs);
  }
}

registerProcessor("audio-nimio-processor", AudioNimioProcessor);

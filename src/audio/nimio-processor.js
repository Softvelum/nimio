import { StateManager } from "@/state-manager";
import { ReadableAudioBuffer } from "@/media/buffers/readable-audio-buffer";
import { ReadableTransAudioBuffer } from "@/media/buffers/readable-trans-audio-buffer";
import { AudioConfig } from "./config";
import { LoggersFactory } from "@/shared/logger";
import { LatencyController } from "@/latency-controller";
import { WsolaProcessor } from "@/media/processors/wsola-processor";

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

    this._stateManager = new StateManager(options.processorOptions.stateSab, {
      shared: options.processorOptions.stateSabShared,
      port: options.processorOptions.stateSabShared ? null : this.port,
      sendInit: false,
    });
    this._sampleRate = options.processorOptions.sampleRate;
    this._channelCount = options.outputChannelCount[0];
    this._sampleCount = options.processorOptions.sampleCount;
    this._audioConfig = new AudioConfig(
      this._sampleRate,
      this._channelCount,
      this._sampleCount,
    );

    this._idle = options.processorOptions.idle;
    this._targetLatencyMs = options.processorOptions.latency;
    this._latencyCtrl = new LatencyController(
      options.processorOptions.instanceName,
      this._stateManager,
      this._audioConfig,
      {
        latency: this._targetLatencyMs,
        tolerance: options.processorOptions.latencyTolerance,
        adjustMethod: options.processorOptions.latencyAdjustMethod,
        video: options.processorOptions.videoEnabled,
        audio: !this._idle,
        port: this.port,
        syncBuffer: options.processorOptions.syncBuffer,
      },
    );
    this._latencyCtrl.speedFn = this._setSpeed.bind(this);

    if (!this._idle) {
      this._createAudioBuffer(options.processorOptions);
    }

    this._speed = 1;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const chCnt = out.length;

    if (this._stateManager.isStopped()) {
      return false; // stop processing
    }

    let sampleCount = (out[0].length * this._speed + 0.5) >>> 0;
    if (this._stateManager.isPaused()) {
      this._insertSilence(out, chCnt, sampleCount);
      return true;
    }

    let curTsUs = this._latencyCtrl.loadCurrentTsUs();
    if (this._idle || this._latencyCtrl.isPending()) {
      this._insertSilence(out, chCnt, sampleCount);
    } else {
      sampleCount = this._audioBuffer.read(curTsUs * 1000, out, this._speed);
    }
    this._latencyCtrl.incCurrentAudioSamples(sampleCount);
    return true;
  }

  _insertSilence(out, chCnt, sampleCount) {
    for (let c = 0; c < chCnt; c++) {
      out[c].fill(0);
    }

    if (!this._idle) {
      let durUs = (this._audioConfig.smpCntToTsUs(sampleCount) + 0.5) >>> 0;
      this._stateManager.incSilenceUs(durUs);
      if (!this._audioBuffer.isShareable) {
        this._audioBuffer.ensureCapacity();
      }
    }
  }

  _setSpeed(speed, availableMs) {
    if (this._speed === speed) return;
    this._speed = speed;
    this._logger.debug(`speed ${speed}`, availableMs, this._targetLatencyMs);
  }

  _createAudioBuffer(params) {
    const AudioBufferClass = params.audioSab
      ? ReadableAudioBuffer
      : ReadableTransAudioBuffer;

    this._audioBuffer = new AudioBufferClass(
      params.audioSab,
      params.capacity,
      this._sampleRate,
      this._channelCount,
      this._sampleCount,
    );
    this._audioBuffer.addPreprocessor(
      new WsolaProcessor(this._channelCount, this._sampleCount, this._logger),
    );
    if (!params.audioSab) {
      this._audioBuffer.setPort(this.port);
    }
  }
}

registerProcessor("audio-nimio-processor", AudioNimioProcessor);

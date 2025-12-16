import { StateManager } from "@/state-manager";
import { ReadableAudioBuffer } from "@/media/buffers/readable-audio-buffer";
import { WritableAudioBuffer } from "@/media/buffers/writable-audio-buffer";
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

    this._stateManager = new StateManager(options.processorOptions.stateSab, {
      shared: options.processorOptions.stateSabShared,
      port: options.processorOptions.stateSabShared ? null : this.port,
    });
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
        tolerance: options.processorOptions.latencyTolerance,
        adjustMethod: options.processorOptions.latencyAdjustMethod,
        video: options.processorOptions.videoEnabled,
        audio: !this._idle,
        port: this.port,
      },
    );
    this._latencyCtrl.speedFn = this._setSpeed.bind(this);

    if (!this._idle) {
      this._portFramesReceived = 0;
      let audioBufferSource = null;
      let audioBufferCapacity = null;
      const hasSharedAudioSab =
        options.processorOptions.audioSabShared !== false &&
        options.processorOptions.audioSab;
      if (hasSharedAudioSab) {
        audioBufferSource = options.processorOptions.audioSab;
        audioBufferCapacity = options.processorOptions.capacity;
      } else {
        this._audioBufferWriter = WritableAudioBuffer.allocate(
          options.processorOptions.bufferSec,
          this._sampleRate,
          this._channelCount,
          this._fSampleCount,
        );
        audioBufferSource = this._audioBufferWriter.buffer;
        audioBufferCapacity = this._audioBufferWriter.bufferCapacity;
        this.port.addEventListener(
          "message",
          this._handlePortMessage.bind(this),
        );
        if (this.port.start) this.port.start();
      }

      this._audioBuffer = new ReadableAudioBuffer(
        audioBufferSource,
        audioBufferCapacity,
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
      const available = this._audioBuffer.getSize
        ? this._audioBuffer.getSize()
        : undefined;
      const read = this._audioBuffer.read(
        curTsUs * 1000,
        incTsUs * 1000,
        out,
        this._speed,
      );
      if ((available === 0 || read === 0) && this._portFramesReceived < 3) {
        this._logger.debug(
          "Audio read empty",
          available,
          read,
          curTsUs,
          incTsUs,
        );
      }
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

  _handlePortMessage(event) {
    const msg = event.data;
    if (!msg || msg.type === "log" || !this._audioBufferWriter) return;

    try {
      if (msg.type === "audio:pcm" && msg.pcm) {
        const pcm =
          msg.pcm instanceof Float32Array ? msg.pcm : new Float32Array(msg.pcm);
        this._audioBufferWriter.pushPcm(msg.timestamp || 0, pcm);
        this._portFramesReceived++;
        if (this._portFramesReceived <= 3) {
          this._logger.debug(
            "Audio PCM via port",
            pcm.length,
            this._audioBufferWriter.sampleRate,
            `${this._audioBufferWriter.numChannels}ch`,
          );
        }
      } else if (msg.type === "audio:silence") {
        this._audioBufferWriter.pushSilence(msg.timestamp || 0);
      } else if (msg.type === "audio:reset") {
        this._audioBufferWriter.reset();
      }
    } catch (err) {
      this._logger.error("Audio worklet port message failed", msg.type, err);
    }
  }
}

registerProcessor("audio-nimio-processor", AudioNimioProcessor);

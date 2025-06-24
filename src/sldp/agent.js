export class SLDPAgent {
  constructor() {
    this._webSocketWorker = new Worker(
      new URL("../transport/web-socket.js", import.meta.url),
      { type: "module" },
    );
    this._webSocketWorker.addEventListener("message", (e) => {
      this._processWorkerMessage(e);
    });
    this._webSocketWorker.postMessage({ type: "initShared", sab: this._sab });
  }

  start (url, offset) {
    this._webSocketWorker.postMessage({
      type: "initWebSocket",
      url: url,
      protocols: ["sldp.softvelum.com"],
      startOffset: offset,
    });
  }

  stop (closeConnection) {
    this._webSocketWorker.postMessage({
      type: "stop",
      close: closeConnection,
    });
  }

  _processWorkerMessage(e) {
    const type = e.data.type;
    switch (type) {
      case "videoConfig":
        if (!e.data.videoConfig) {
          this._noVideo = true;
          break;
        }
        this._videoDecoderWorker.postMessage({
          type: "videoConfig",
          videoConfig: e.data.videoConfig,
        });
        break;
      case "audioConfig":
        if (!e.data.audioConfig) {
          this._startNoAudioMode();
          break;
        }
        this._audioDecoderWorker.postMessage({
          type: "audioConfig",
          audioConfig: e.data.audioConfig,
        });
        break;
      case "videoCodecData":
        this._videoDecoderWorker.postMessage({
          type: "codecData",
          codecData: e.data.codecData,
        });
        break;
      case "audioCodecData":
        if (this._noAudio) {
          this._stopAudio();
        }

        let config = this._audioService.parseAudioConfig(e.data.codecData);
        this._audioDecoderWorker.postMessage({
          type: "codecData",
          codecData: e.data.codecData,
          aacConfig: config,
        });

        this._audioBuffer = WritableAudioBuffer.allocate(
          this._bufferSec * 5, // reserve 5 times buffer size for development (TODO: reduce later)
          config.sampleRate,
          config.numberOfChannels,
          config.sampleCount,
        );
        this._audioBuffer.addPreprocessor(
          new AudioGapsProcessor(
            this._audioService.sampleCount,
            this._audioService.sampleRate,
          ),
        );
        break;
      case "videoChunk":
        this._videoDecoderWorker.postMessage(
          {
            type: "videoChunk",
            timestamp: e.data.timestamp,
            chunkType: e.data.chunkType,
            frameWithHeader: e.data.frameWithHeader,
            framePos: e.data.framePos,
          },
          [e.data.frameWithHeader],
        );
        break;
      case "audioChunk":
        this._audioDecoderWorker.postMessage(
          {
            type: "audioChunk",
            timestamp: e.data.timestamp,
            frameWithHeader: e.data.frameWithHeader,
            framePos: e.data.framePos,
          },
          [e.data.frameWithHeader],
        );
        break;
      case "videoFrame":
        let frame = e.data.videoFrame;
        let frameTsUs = frame.timestamp;
        if (
          null === this._firstFrameTsUs &&
          (this._noAudio || this._videoBuffer.getTimeCapacity() >= 0.5)
        ) {
          this._firstFrameTsUs = frameTsUs;
          this._state.setPlaybackStartTsUs(frameTsUs);

          if (!this._noAudio) {
            this._startNoAudioMode();
          }
        }
        this._videoBuffer.addFrame(frame, frameTsUs);
        this._state.setVideoLatestTsUs(frameTsUs);
        this._state.setVideoDecoderQueue(e.data.decoderQueue);
        this._state.setVideoDecoderLatency(e.data.decoderLatency);
        break;
      case "audioFrame":
        e.data.audioFrame.rawTimestamp = e.data.rawTimestamp;
        e.data.audioFrame.decTimestamp = e.data.decTimestamp;
        this._handleAudioFrame(e.data.audioFrame);
        this._state.setAudioDecoderQueue(e.data.decoderQueue);
        break;
      case "decoderError":
        // TODO: show error message in UI
        if (e.data.kind === "video") this._noVideo = true;
        if (e.data.kind === "audio") this._noAudio = true;

        if (this._noVideo && this._noAudio) {
          this.stop(true);
        }
        break;
      default:
        break;
    }
  }
}

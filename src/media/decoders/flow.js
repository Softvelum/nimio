import { MetricsManager } from "@/metrics/manager";
import LoggersFactory from "@/shared/logger";

const SWITCH_THRESHOLD_US = 8_000_000;

export class DecoderFlow {
  constructor(instanceName, trackId, timescale, type, url) {
    this._logger = LoggersFactory.create(
      instanceName,
      `${type} flow (${trackId})`,
    );

    this._trackId = trackId;
    this._type = type;
    this._startTsUs = 0;
    this._buffer = null;

    // TODO: check if timescale is needed further
    this._timescale = timescale;
    this._metricsManager = MetricsManager.getInstance(instanceName);
    this._metricsManager.add(this._trackId, this._type);

    this._decoder = new Worker(new URL(url, import.meta.url), {
      type: "module",
    });
    this._addDecoderListener();
  }

  isActive() {
    return this._buffer !== null;
  }

  setBuffer(buffer, state) {
    this._buffer = buffer;
    this._state = state;
  }

  setConfig(config) {
    this._decoder.postMessage({
      type: "config",
      config: config,
    });
  }

  setCodecData(data) {
    let msg = { type: "codecData" };
    for (let key in data) {
      msg[key] = data[key];
    }
    this._decoder.postMessage(msg);
  }

  processChunk(data) {
    if (data.trackId !== this._trackId || this._isShuttingDown) {
      return false;
    }

    if (this._switchContext) {
      if (this._switchContext.inputCancelled) return false;

      if (this._switchContext.dst && data.chunkType === "key") {
        let srcFirstTsUs = this._switchPeerFlow.firstSwitchTsUs;
        if (
          srcFirstTsUs !== null &&
          Math.abs(data.timestamp - srcFirstTsUs) < SWITCH_THRESHOLD_US &&
          data.timestamp >= srcFirstTsUs
        ) {
          // Source flow already has a frame with this timestamp, cancel input
          this._logger.debug(
            `Cancel input for dst from pushChunk ${data.timestamp}`,
          );
          this._updateSwitchTimestamps(data.timestamp);
          this._cancelInput();
          return false;
        }
      }
    }

    this._decoder.postMessage(
      {
        type: "chunk",
        timestamp: data.timestamp,
        chunkType: data.chunkType,
        frameWithHeader: data.frameWithHeader,
        framePos: data.framePos,
      },
      [data.frameWithHeader],
    );

    return true;
  }

  exportDecoder() {
    this._removeDecoderListener();
    let decoder = this._decoder;
    this._decoder = null;

    return decoder;
  }

  switchTo(flow, type = "dst") {
    this._switchPeerFlow = flow;
    if (this._startSwitch(type)) {
      this._switchPeerFlow.switchTo(this, type === "dst" ? "src" : "dst");
    }
  }

  destroy() {
    if (this._isShuttingDown || !this._decoder) return;

    this._switchPeerFlow = null;
    this._cancelInput();
    this._shutdown();
    this._trackId = null;
    this._buffer.reset();
    this._buffer = null;
  }

  finalizeSwitch() {
    this._cancelInput();
    this._shutdown();
  }

  _startSwitch(type) {
    if (this._switchContext) return false;

    this._switchContext = {
      [type]: true,
      handleFrame:
        type === "dst"
          ? this._handleDstSwitchFrame.bind(this)
          : this._handleSrcSwitchFrame.bind(this),
    };
    return true;
  }

  _cancelInput() {
    if (this._switchContext && !this._switchContext.inputCancelled) {
      this._switchContext.inputCancelled = true;
      this._onInputCancel();
    }
  }

  _shutdown() {
    this._logger.debug("Shutdown start", this._isShuttingDown);
    if (this._isShuttingDown) return;

    this._isShuttingDown = true;
    this._metricsManager.remove(this._trackId);
    this._decoder.postMessage({ type: "shutdown" });
  }

  async _handleDecoderMessage(e) {
    switch (e.data.type) {
      case "decodedFrame":
        let frame = this._prepareFrame(e.data);
        if (this._switchContext) {
          this._updateSwitchTimestamps(frame.timestamp);
          this._switchContext.handleFrame(frame);
          if (this._switchContext?.src) break;
        }
        await this._handleDecoderOutput(frame, e.data);
        break;
      case "decoderError":
        if (this._switchContext?.src) {
          this._onSwitchResult(false);
          this.destroy();
          break;
        }
        this._onDecodingError(this._type);
        break;
      case "shutdownComplete":
        this._logger.debug("Shutdown has completed");
        this._isShuttingDown = null;
        if (this._decoder) {
          this._removeDecoderListener();
          this._decoder.terminate();
          this._decoder = null;
        }
        if (this._switchPeerFlow) {
          this._decoder = this._switchPeerFlow.exportDecoder();
          this._buffer.absorb(this._switchPeerFlow.buffer);
          this._switchPeerFlow.setBuffer(null, null);
          this._addDecoderListener();
          this._trackId = this._switchPeerFlow.trackId;
          this._timescale = this._switchPeerFlow.timescale;
          this._switchPeerFlow = null;
          this._switchContext = null;
          this._onSwitchResult(true);
        }
        break;
      default:
        this._logger.warn(
          `Unknown message DecoderFlow ${this._type}: ${e.data.type}`,
        );
        break;
    }
  }

  _handleDstSwitchFrame(frame) {
    if (this._isShuttingDown) return;

    let srcFirstTsUs = this._switchPeerFlow.firstSwitchTsUs;
    if (srcFirstTsUs !== null) {
      if (Math.abs(frame.timestamp - srcFirstTsUs) >= SWITCH_THRESHOLD_US) {
        this._logger.debug(
          `Handle dst switch frame - excessive diff dst ts: ${frame.timestamp}, src ts: ${srcFirstTsUs}`,
        );
        this._switchContext = null;
        this._switchPeerFlow.destroy();
        this._switchPeerFlow = null;
        this._onSwitchResult(false);
        return;
      }

      if (frame.timestamp >= this._switchPeerFlow.firstSwitchTsUs) {
        this._logger.debug(
          `Finalize switch for dst ts: ${frame.timestamp}, src ts: ${this._switchPeerFlow.firstSwitchTsUs}`,
        );
        this.finalizeSwitch();
      }
    }
  }

  _handleSrcSwitchFrame(frame) {
    if (this._isShuttingDown) return;

    let firstTsUs = this._switchContext.firstTsUs;
    let dstLastTsUs = this._switchPeerFlow.lastSwitchTsUs;

    if (dstLastTsUs !== null && !this._switchPeerFlow.isShuttingDown) {
      if (Math.abs(firstTsUs - dstLastTsUs) >= SWITCH_THRESHOLD_US) {
        this._logger.debug(
          `Handle src switch frame - excessive diff, src ts: ${firstTsUs}, dst ts: ${dstLastTsUs}`,
        );
        frame.close();
        this.destroy();
        return;
      }

      if (firstTsUs <= dstLastTsUs) {
        this._logger.debug("Finalize switch for src", firstTsUs, dstLastTsUs);
        this._switchPeerFlow.finalizeSwitch();
      }
    }
    this._pushToBuffer(frame);
  }

  _updateSwitchTimestamps(ts) {
    if (!this._switchContext.firstTsUs) {
      this._switchContext.firstTsUs = ts;
    }
    if (!this._switchContext.lastTsUs || ts > this._switchContext.lastTsUs) {
      this._switchContext.lastTsUs = ts;
    }
  }

  async _handleDecodedFrame(frame) {
    if (this._state.isStopped()) {
      frame.close();
      return true;
    }

    if (this._startTsUs === 0) {
      if (this._onStartTsNotSet) {
        let res = await this._onStartTsNotSet(frame);
        if (!res) {
          frame.close();
          return false; // flow output failed
        }
      }

      // check _startTsUs to avoid multiple assignments when all promises are resolved
      if (this._startTsUs === 0) {
        this._startTsUs = this._state.getPlaybackStartTsUs();
      }
    }

    this._pushToBuffer(frame);
    return true;
  }

  _pushToBuffer(frame) {
    this._buffer.pushFrame(frame);
    if (this._buffer.isShareable) {
      frame.close();
    }
  }

  _addDecoderListener() {
    if (this._decoderListener) return;
    this._decoderListener = this._handleDecoderMessage.bind(this);
    this._decoder.addEventListener("message", this._decoderListener);
  }

  _removeDecoderListener() {
    if (!this._decoderListener) return;
    this._decoder.removeEventListener("message", this._decoderListener);
    this._decoderListener = null;
  }

  get trackId() {
    return this._trackId;
  }
  get timescale() {
    return this._timescale;
  }
  get buffer() {
    return this._buffer;
  }

  get onStartTsNotSet() {
    return this._onStartTsNotSet;
  }
  set onStartTsNotSet(callback) {
    this._onStartTsNotSet = callback;
  }

  get onDecodingError() {
    return this._onDecodingError;
  }
  set onDecodingError(callback) {
    this._onDecodingError = callback;
  }

  get onSwitchResult() {
    return this._onSwitchResult;
  }
  set onSwitchResult(callback) {
    this._onSwitchResult = callback;
  }

  get onInputCancel() {
    return this._onInputCancel;
  }
  set onInputCancel(callback) {
    this._onInputCancel = callback;
  }

  get firstSwitchTsUs() {
    if (this._switchContext) {
      return this._switchContext.firstTsUs || null;
    }
    return null;
  }

  get lastSwitchTsUs() {
    if (this._switchContext) {
      return this._switchContext.lastTsUs || null;
    }
    return null;
  }

  get isShuttingDown() {
    return !!this._isShuttingDown;
  }
}

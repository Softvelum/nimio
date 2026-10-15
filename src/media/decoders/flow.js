import { TimestampManager } from "./timestamp-manager";
import { MetricsManager } from "@/metrics/manager";
import { LoggersFactory } from "@/shared/logger";
import { EventBus } from "@/event-bus";
import { runCleanupSteps } from "@/shared/helpers";

const SWITCH_THRESHOLD_US = 8_000_000;
const SWITCH_ABORT_MSG =
  "Rendition switch aborted: the new rendition's decoder stopped";
// Time given to the decoder worker to acknowledge "shutdown" before the
// thread is killed from the main side (worker crashed or never replied).
const SHUTDOWN_FALLBACK_MS = 1000;

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

    this._timestampManager = TimestampManager.getInstance(instanceName);
    this._timestampManager.addTrack(this._trackId, this._type);

    this._eventBus = EventBus.getInstance(instanceName);
    this._decoder = new Worker(url, {
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
    this._codec = config.codec;
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
    if (this._switchContext) {
      if (this._switchContext.inputCancelled) return false;

      if (this._switchContext.dst && data.chunkType === "key") {
        let srcFirstTsUs = this._switchPeerFlow.firstSwitchTsUs;
        if (
          srcFirstTsUs !== null &&
          Math.abs(data.pts - srcFirstTsUs) < SWITCH_THRESHOLD_US &&
          data.pts >= srcFirstTsUs
        ) {
          // Source flow already has a frame with this timestamp, cancel input
          this._logger.debug(`Cancel input for dst from pushChunk ${data.pts}`);
          this._updateSwitchTimestamps(data.pts);
          this._cancelInput();
          return false;
        }
      }
    }

    this._decoder.postMessage(
      {
        type: "chunk",
        pts: data.pts,
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
      const peerTrackId = this._switchPeerFlow.trackId;
      this._timestampManager.updateTimeBase(peerTrackId, this._trackId);
      this._switchPeerFlow.switchTo(this, type === "dst" ? "src" : "dst");
    }
  }

  destroy() {
    if (this._destroyed) return; // idempotent: one shutdown, one fallback timer
    // messages still in flight from the worker must not reach the buffer,
    // the engine or a switch peer once the flow is destroyed
    this._destroyed = true;
    const decoder = this._decoder;
    const peer = this._switchPeerFlow;
    this._switchPeerFlow = null;
    // Each step may reach application code (the peer notification runs the
    // main flow's switch-result and decoding-error callbacks: engine, facade,
    // application listener; the cancel reaches the SLDP manager and the
    // transport; the shutdown the metrics/timestamp services and the bus):
    // a failure in one must not skip the others, nor keep the worker alive
    const steps = [];
    if (peer && peer._switchPeerFlow === this) {
      // a paired peer learns that this side of the switch is gone
      steps.push(["switch peer", () => peer._onPeerDestroyed()]);
    }
    if (decoder) {
      steps.push(["input cancel", () => this._cancelInput()]);
      // no-op when a switch already posted the shutdown
      steps.push(["shutdown", () => this._shutdown()]);
    }
    runCleanupSteps(this._logger, "decoder flow destroy", steps);
    if (!decoder) return;

    // whatever the worker does with the shutdown, it is terminated
    this._scheduleForcedTermination(decoder);
    this._trackId = null;
    if (this._buffer) {
      this._buffer.reset();
      this._buffer = null;
    }
  }

  finalizeSwitch() {
    this._cancelInput();
    this._shutdown();
  }

  _canHandleChunk(data) {
    return data.trackId === this._trackId && !this._isShuttingDown;
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

  // The other side of an in-progress switch was destroyed. Drop the switch
  // state; the main (dst) flow owns the result.
  _onPeerDestroyed() {
    if (this._switchContext?.dst) {
      this._failSwitch(SWITCH_ABORT_MSG);
      return;
    }
    // the src side only forgets the pairing; the main flow owns the result
    this._switchContext = null;
    this._switchPeerFlow = null;
  }

  // Main (dst) flow: drop the switch state, report the failure once, and
  // recover when this flow cannot continue on its own. Returns the former
  // peer (already unpaired, so destroying it sends no notification back).
  _failSwitch(msg, lostDecoder = false) {
    const inputCancelled = !!this._switchContext?.inputCancelled;
    const peer = this._switchPeerFlow;
    this._switchContext = null;
    this._switchPeerFlow = null;
    // teardown is silent: _resetPlayback() destroys flows after the stop
    if (this._state?.isStopped()) return peer;
    this._onSwitchResult?.(false, msg);
    if (lostDecoder || inputCancelled || this._isShuttingDown) {
      // our server stream was already cancelled (processChunk() on a dst key
      // chunk, or finalizeSwitch()), or our decoder is gone: let the engine
      // handle the loss of this media type as a decoding error
      this._onDecodingError?.(this._type);
    }
    return peer;
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
    this._timestampManager.removeTrack(this._trackId);
    this._decoder.postMessage({ type: "shutdown" });
    this._eventBus.emit("transp:track-action", {
      op: "rem",
      id: this._trackId,
      type: this._type,
    });
  }

  async _handleDecoderMessage(e) {
    switch (e.data.type) {
      case "decodedFrame":
        let frame = this._prepareFrame(e.data);
        if (this._destroyed) {
          frame.close();
          break;
        }
        if (this._switchContext) {
          this._updateSwitchTimestamps(frame.timestamp);
          this._switchContext.handleFrame(frame);
          if (this._switchContext?.src) break;
        }
        await this._handleDecoderOutput(frame, e.data);
        break;
      case "decoderError":
        if (this._destroyed) break;
        if (this._switchContext?.src) {
          // the new rendition's decoder failed: destroying notifies the main
          // flow, which owns the switch result
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
        if (this._destroyed) {
          // destroyed while a switch was finalizing: adopt nothing
          this._switchPeerFlow = null;
          this._switchContext = null;
          break;
        }
        if (this._switchPeerFlow && !this._switchPeerFlow.isActive()) {
          // the peer was released without telling us: nothing to adopt, and
          // our own worker is gone
          this._failSwitch(SWITCH_ABORT_MSG, true);
          break;
        }
        if (this._switchPeerFlow) {
          this._decoder = this._switchPeerFlow.exportDecoder();
          this._buffer.absorb(this._switchPeerFlow.buffer);
          this._switchPeerFlow.setBuffer(null, null);
          this._addDecoderListener();
          this._trackId = this._switchPeerFlow.trackId;
          this._codec = this._switchPeerFlow.codec;
          this._timescale = this._switchPeerFlow.timescale;
          this._applyCodecDataFromFlow(this._switchPeerFlow);

          this._switchPeerFlow = null;
          this._switchContext = null;
          this._onSwitchResult(true);
          this._eventBus.emit("transp:track-action", {
            op: "main",
            id: this._trackId,
            type: this._type,
          });
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
      let absDiff = Math.abs(frame.timestamp - srcFirstTsUs);
      if (absDiff >= SWITCH_THRESHOLD_US) {
        this._logger.debug(
          `Handle dst switch frame - excessive diff dst ts: ${frame.timestamp}, src ts: ${srcFirstTsUs}`,
        );
        const peer = this._failSwitch(
          `Rendition switch isn't possible, because timestamps of renditions aren't in sync: the gap is approximately ${(absDiff / 1_000_000).toFixed(1)} seconds. Please check your ABR setup.`,
        );
        peer.destroy(); // already unpaired: no notification back
        return;
      }

      if (frame.timestamp >= srcFirstTsUs) {
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
    if (this._destroyed || !this._buffer) {
      frame.close();
      return false;
    }
    if (this._state.isStopped()) {
      frame.close();
      return true;
    }

    if (this._startTsUs === 0) {
      if (this._onStartTsNotSet) {
        let res;
        try {
          res = await this._onStartTsNotSet(frame);
        } catch (err) {
          this._logger.error("Flow output initialization failed", err);
          res = false;
        }
        if (!res || this._destroyed || !this._buffer) {
          // output failed, or the flow was destroyed while waiting
          frame.close();
          return false;
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
    if (this._buffer.isPreallocated) {
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

  // Fallback for a worker that never posts shutdownComplete. Keyed on the
  // worker identity: if the acknowledgement arrived (or a switch adopted the
  // peer's worker) this._decoder no longer points at it and nothing happens.
  _scheduleForcedTermination(decoder) {
    setTimeout(() => {
      if (this._decoder !== decoder) return;
      this._removeDecoderListener();
      decoder.terminate();
      this._decoder = null;
    }, SHUTDOWN_FALLBACK_MS);
  }

  _applyCodecDataFromFlow() {} // abstract base method

  get trackId() {
    return this._trackId;
  }
  get timescale() {
    return this._timescale;
  }
  get buffer() {
    return this._buffer;
  }
  get codec() {
    return this._codec;
  }
  get codecData() {
    return this._codecData;
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

  get onDecodedBufferFull() {
    return this._onDecodedBufferFull;
  }
  set onDecodedBufferFull(callback) {
    this._onDecodedBufferFull = callback;
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

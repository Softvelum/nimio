export class DecoderFlow {
  constructor(trackId, timescale, url) {
    this._trackId = trackId;
    this._timescale = timescale;
    this._startTsUs = 0;

    let workerUrl = new URL(url, import.meta.url);
    this._decoder = new Worker(workerUrl, { type: "module" });
    this._addDecoderListener();
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
    if (data.trackId !== this._trackId) {
      return;
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
  }

  exportDecoder() {
    this._removeDecoderListener();
    let decoder = this._decoder;
    this._decoder = null;

    return decoder;
  }

  merge(flow) {
    // this._decoder.postMessage({ type: "shutdown" });
    this._mSourceFlow = flow;
  }

  async _handleDecoderMessage(e) {
    switch (e.data.type) {
      case "decodedFrame":
        await this._handleDecodedData(e.data);
        break;
      case "decoderError":
        this._onDecodingError(this._type);
        break;
      case "shutdownComplete":
        if (this._decoder) {
          this._removeDecoderListener();
          this._decoder.terminate();
          this._decoder = null;
        }
        if (this._mSourceFlow) {
          this._decoder = this._mSourceFlow.exportDecoder();
          this._buffer.absorb(this._mSourceFlow.buffer);
          this._mSourceFlow.setBuffer(null, null);
          this._addDecoderListener();
          this._mSourceFlow = null;
        }
        break;
      default:
        console.warn(`Unknown message DecoderFlow ${this._type}: ${e.data.type}`);
        break;
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

    this._buffer.pushFrame(frame);
    if (this._buffer.isShareable) {
      frame.close();
    }
    return true;
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


  _needToCancelCurrentTrack(timestamp, isKey) {
    let result = false;
    let tpLen = this._switchParams.newSapTimes.length;
    if (tpLen > 0) {
      if (_sapAlignment) {
        if (isKey && timestamp >= this._switchParams.newSapTimes[0]) {
          result = true;
        }
      } else {
        if (
          timestamp >=
          this._switchParams.newSapTimes[0] +
            2 * ((_transBuffering * _timescale) / 1000)
        ) {
          this._logger.debug(
            "Cancel current stream, because current timestamp is twice ahead possible buffer of new stream",
            timestamp,
            this._switchParams.newSapTimes[0],
          );
          result = true;
        } else {
          for (
            let i = this._switchParams.newSapTimes.length - 1;
            i >= 0;
            i--
          ) {
            if (
              Math.abs(timestamp - this._switchParams.newSapTimes[i]) <
              _smoothBorder()
            ) {
              this._logger.debug(
                "Cancel current stream. Timestamp " +
                  timestamp +
                  " is near new stream key frame " +
                  this._switchParams.newSapTimes[i],
              );
              result = true;
              break;
            } else if (timestamp > this._switchParams.newSapTimes[i]) {
              break;
            }
          }
        }
      }
    }
    return result;
  }








  processFrame(isKey, data, timestamp, compositionOffset) {
    let result = { done: true };
    this._lastBufferedTimestamp = timestamp;
    this._lastBufferedOffset = compositionOffset;

    if (this._switchStarted) {
      if (this._switchParams.curStreamCancelled) {
        return result;
      } else {
        this._logger.debug(
          `processFrame switch, current frame ts=${timestamp}, offset=${compositionOffset}, sap=${isKey}`,
        );

        if (isKey) this._switchParams.curSapTimes.push(timestamp);
        this._switchParams.curStreamLastBufferedTs = timestamp;
        if (this._needToCancelCurrentStream(timestamp, isKey)) {
          this._logger.debug(
            "processFrame cancel current rendition",
            this._switchParams.curStreamLastBufferedTs,
            isKey,
          );
          if (this._cancelStreamCallback) {
            this._cancelStreamCallback(this);
          }
          this._switchParams.curStreamCancelled = true;
          _pushTo(_startupBuffer, data, timestamp, compositionOffset, isKey);
          return result;
        }
      }
    }

    this._processFrameInternal(isKey, data, timestamp, compositionOffset);

    if (result.done) {
      _errorsCount = 0;
    } else {
      result.errors = _errorsCount;
    }
    return result;
  }

  _processFrameInternal(isKey, data, timestamp, compositionOffset) {
    if (_sapSet) {
      _pushFrame(isKey, data, timestamp, compositionOffset);
    } else if (isKey) {
      if (_initSegmentSwitch && TRACK_STATE.CLOSED !== _state) {
        let opts = { codec: _codec };
        if (_initSegmentData) {
          opts.codecData = _initSegmentData;
          if ("v" === _type[0]) {
            _processNalUnit(null, _initSegmentData);
          }
        }
        _composer.setTrackParams(_cTrackId, opts);
        _sourceBuffer.pushInit(
          _composer.initSegment(),
          _isFrameContinual(timestamp)[0],
        );
        _initSegmentSwitch = false;

        if ("a" === _type[0] && _initSegmentData) {
          _updateRelatedAudioInfo();
        }
      }
      _processFirstFrame(data, timestamp, compositionOffset);
    }
  }

  processTransitionFrame(isKey, data, timestamp, compositionOffset) {
    let result = { done: true };
    if (isKey) {
      this._switchParams.newSapTimes.push(timestamp);
    } else if (0 === this._switchParams.newSapTimes.length) {
      return result;
    }

    let tsbLen = this._switchParams.startupBuffer.length;
    if (tsbLen > 0) {
      if (undefined == this._switchParams.lastSampleDuration) {
        this._switchParams.lastSampleDuration =
          undefined !== _maxDuration ? _maxDuration : 0;
      }
      let prevSample = this._switchParams.startupBuffer[tsbLen - 1];
      let prevSampleDuration = timestamp - prevSample.ts;
      if (prevSampleDuration < 0) {
        if (compositionOffset >= -1 * prevSampleDuration) {
          compositionOffset += prevSampleDuration;
          prevSampleDuration = 0;
        } else {
          prevSampleDuration = this._switchParams.lastSampleDuration;
        }
      } else if (prevSampleDuration > 2 * _timescale) {
        prevSampleDuration = this._switchParams.lastSampleDuration;
      }

      timestamp = prevSample.ts + prevSampleDuration;
      this._switchParams.lastSampleDuration = prevSampleDuration;
    }
    this._pushTo(
      this._switchParams.startupBuffer,
      data,
      timestamp,
      compositionOffset,
      isKey,
    );
    if (this._needToSwitchToNewStream(timestamp, isKey)) {
      if (!this._switchParams.curStreamCancelled) {
        this._logger.debug("processTransitionFrame cancel current rendition");
        this._cancelStreamCallback(this);
        this._switchParams.curStreamCancelled = true;
      }

      let lastReceivedTs = _lastReceivedTimestamp;
      if (
        this._switchParams.curStreamLastBufferedTs &&
        this._switchParams.curStreamLastBufferedTs > lastReceivedTs
      ) {
        lastReceivedTs = this._switchParams.curStreamLastBufferedTs;
      }
      let flushBorder = this._switchParams.newSapTimes[0];
      let i = 0;
      let minGap = Math.abs(
        this._switchParams.newSapTimes[0] - lastReceivedTs,
      );
      for (i = this._switchParams.newSapTimes.length - 1; i >= 1; i--) {
        let curGap = Math.abs(
          this._switchParams.newSapTimes[i] - lastReceivedTs,
        );
        if (curGap < minGap) {
          minGap = curGap;
          flushBorder = this._switchParams.newSapTimes[i];
        }
      }

      for (i = 0; i < this._switchParams.startupBuffer.length; i++) {
        if (this._switchParams.startupBuffer[i].ts >= flushBorder) break;
      }

      if (i > 0) {
        this._switchParams.startupBuffer.splice(0, i);
        let iData;
        for (let j = 0; j < this._switchParams.initDataBuffer.length; j++) {
          if (this._switchParams.initDataBuffer[j].idx <= i) {
            iData = this._switchParams.initDataBuffer.shift();
            j--;
          } else {
            this._switchParams.initDataBuffer[j].idx -= i;
          }
        }
        if (iData) {
          this._switchParams.composer.setTrackParams(
            this._switchParams.cTrackId,
            { codec: this._switchParams.codec, codecData: iData.data },
          );
          this._switchParams.initSegmentData = iData.data;
          this._switchParams.initSegment =
            this._switchParams.composer.initSegment();
          _processNalUnit(null, iData.data);
        }
      }

      let fCont = this._isFrameContinual(flushBorder);
      _sourceBuffer.pushInit(this._switchParams.initSegment, fCont[0]);
      if (this._switchStarted) {
        let edge = fCont[1];
        this._logger.debug(
          `switch buffer length = ${this._switchParams.startupBuffer.length}`,
        );
        this._logger.debug(
          `===== Rendition switch GAP ===== ${1000 * edge} msec, allowance = ${1000 * fCont[2]}`,
        );
        this.completeTransition();
        this.applyTransition();
        if (-edge > 10) {
          result.done = false;
          this._logger.error(
            `Correct rendition switch isn't possible, gap is too big (${edge}s). Reloading stream.`,
          );
        }
      }
    }
    return result;
  }



  _needToSwitchToNewStream(timestamp) {
    let result = false;
    let maxShift = (_transBuffering * _timescale) / 1000;
    let curSapTimesLength = this._switchParams.curSapTimes.length;
    let newSapTimesLength = this._switchParams.newSapTimes.length;
    let tsDiff = timestamp - this._switchParams.startupBuffer[0].ts;
    if (_sapAlignment && TRANSITION_MODE.ABRUPT != this._switchParams.mode) {
      if (tsDiff >= maxShift) {
        if (curSapTimesLength > 0) {
          let curK = 0;
          for (let j = 0; j < curSapTimesLength; j++) {
            if (
              this._switchParams.curSapTimes[j] <
                this._switchParams.newSapTimes[curK] ||
              this._switchParams.curSapTimes[j] <= _lastProcessedTimestamp
            ) {
              continue;
            }
            for (let k = curK; k < newSapTimesLength; k++) {
              curK = k;
              if (
                this._switchParams.newSapTimes[k] >
                this._switchParams.curSapTimes[j]
              ) {
                break;
              } else if (
                this._switchParams.newSapTimes[k] ==
                this._switchParams.curSapTimes[j]
              ) {
                this._logger.debug(
                  "Switch to new stream because of SAP alignment",
                );
                result = true;
              }
            }
            if (result) break;
          }
        } else if (newSapTimesLength > 0) {
          this._logger.debug("No current stream frames, switch to new stream");
          result = true;
        }
      }
      if (
        !result &&
        curSapTimesLength >= 1 &&
        newSapTimesLength >= 2 &&
        this._switchParams.newSapTimes[newSapTimesLength - 1] > this._switchParams.curSapTimes[0]
      ) {
        this._logger.debug("Switch to new stream SAP alignment does not work!");
        result = true;
      }
    } else if (
      tsDiff >= 2 * maxShift &&
      (timestamp >= this._switchParams.curStreamLastBufferedTs ||
        undefined == this._switchParams.curStreamLastBufferedTs)
    ) {
      this._logger.debug(
        "Switch to new stream because switch buffer is twice filled",
      );
      result = true;
    } else if (tsDiff >= maxShift) {
      if (
        this._switchParams.curStreamCancelled &&
        (timestamp >= this._switchParams.curStreamLastBufferedTs ||
          undefined == this._switchParams.curStreamLastBufferedTs)
      ) {
        this._logger.debug(
          "Switch to new stream because buffer is filled and current stream is cancelled",
        );
        result = true;
      } else {
        for (let i = this._switchParams.newSapTimes.length - 1; i >= 0; i--) {
          if (
            Math.abs(
              this._switchParams.curStreamLastBufferedTs -
                this._switchParams.newSapTimes[i],
            ) < _smoothBorder()
          ) {
            this._logger.debug(
              "Switch to new stream, because new key frame " +
                this._switchParams.newSapTimes[i] +
                " is near to current latest timestamp " +
                this._switchParams.curStreamLastBufferedTs,
            );
            result = true;
            break;
          } else if (
            this._switchParams.curStreamLastBufferedTs >
            this._switchParams.newSapTimes[i]
          ) {
            break;
          }
        }
        if (
          !result &&
          timestamp + 2 * maxShift < this._switchParams.curStreamLastBufferedTs
        ) {
          if (tsDiff >= 10 * _timescale) {
            this._logger.error(
              "Error: new stream is " +
                (this._switchParams.curStreamLastBufferedTs - timestamp) /
                  _timescale +
                " seconds behind previous stream. Halting.",
            );
            result = true;
          }
        }
      }
    }
    return result;
  }
}

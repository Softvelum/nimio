export class DecoderFlow {
  constructor(trackId, timescale, url) {
    this._trackId = trackId;
    this._timescale = timescale;
    this._startTsUs = 0;

    const workerUrl = new URL(url, import.meta.url);
    this._decoder = new Worker(workerUrl, { type: "module" });
    this._decoder.addEventListener("message", async (e) => {
      await this._handleDecoderMessage(e);
    });
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

  async _handleDecoderMessage(e) {
    switch (e.data.type) {
      case "decodedFrame":
        await this._handleDecodedData(e.data);
        break;
      case "decoderError":
        this._onDecodingError(this._type);
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

  get trackId() {
    return this._trackId;
  }
  get timescale() {
    return this._timescale;
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

  processFrame(isSAP, data, timestamp, compositionOffset) {
    let result = { done: true };
    this._lastBufferedTimestamp = timestamp;
    this._lastBufferedOffset = compositionOffset;

    if (this._transitStarted) {
      if (this._transitParams.curStreamCancelled) {
        return result;
      } else {
        this._logger.debug(
          `processFrame transition, current frame ts=${timestamp}, offset=${compositionOffset}, sap=${isSAP}`,
        );

        if (isSAP) this._transitParams.curSapTimes.push(timestamp);
        this._transitParams.curStreamLastBufferedTs = timestamp;
        if (this._needToCancelCurrentStream(timestamp, isSAP)) {
          this._logger.debug(
            "processFrame cancel current rendition",
            this._transitParams.curStreamLastBufferedTs,
            isSAP,
          );
          if (this._cancelStreamCallback) {
            this._cancelStreamCallback(this);
          }
          this._transitParams.curStreamCancelled = true;
          _pushTo(_startupBuffer, data, timestamp, compositionOffset, isSAP);
          return result;
        }
      }
    }

    this._processFrameInternal(isSAP, data, timestamp, compositionOffset);

    if (result.done) {
      _errorsCount = 0;
    } else {
      result.errors = _errorsCount;
    }
    return result;
  }

  _processFrameInternal(isSAP, data, timestamp, compositionOffset) {
    if (_sapSet) {
      _pushFrame(isSAP, data, timestamp, compositionOffset);
    } else if (isSAP) {
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

  processTransitionFrame(isSAP, data, timestamp, compositionOffset) {
    let result = { done: true };
    if (isSAP) {
      this._transitParams.newSapTimes.push(timestamp);
    } else if (0 === this._transitParams.newSapTimes.length) {
      return result;
    }

    let tsbLen = this._transitParams.startupBuffer.length;
    if (tsbLen > 0) {
      if (undefined == this._transitParams.lastSampleDuration) {
        this._transitParams.lastSampleDuration =
          undefined !== _maxDuration ? _maxDuration : 0;
      }
      let prevSample = this._transitParams.startupBuffer[tsbLen - 1];
      let prevSampleDuration = timestamp - prevSample.ts;
      if (prevSampleDuration < 0) {
        if (compositionOffset >= -1 * prevSampleDuration) {
          compositionOffset += prevSampleDuration;
          prevSampleDuration = 0;
        } else {
          prevSampleDuration = this._transitParams.lastSampleDuration;
        }
      } else if (prevSampleDuration > 2 * _timescale) {
        prevSampleDuration = this._transitParams.lastSampleDuration;
      }

      timestamp = prevSample.ts + prevSampleDuration;
      this._transitParams.lastSampleDuration = prevSampleDuration;
    }
    this._pushTo(
      this._transitParams.startupBuffer,
      data,
      timestamp,
      compositionOffset,
      isSAP,
    );
    if (this._needToSwitchToNewStream(timestamp, isSAP)) {
      if (!this._transitParams.curStreamCancelled) {
        this._logger.debug("processTransitionFrame cancel current rendition");
        this._cancelStreamCallback(this);
        this._transitParams.curStreamCancelled = true;
      }

      let lastReceivedTs = _lastReceivedTimestamp;
      if (
        this._transitParams.curStreamLastBufferedTs &&
        this._transitParams.curStreamLastBufferedTs > lastReceivedTs
      ) {
        lastReceivedTs = this._transitParams.curStreamLastBufferedTs;
      }
      let flushBorder = this._transitParams.newSapTimes[0];
      let i = 0;
      let minGap = Math.abs(
        this._transitParams.newSapTimes[0] - lastReceivedTs,
      );
      for (i = this._transitParams.newSapTimes.length - 1; i >= 1; i--) {
        let curGap = Math.abs(
          this._transitParams.newSapTimes[i] - lastReceivedTs,
        );
        if (curGap < minGap) {
          minGap = curGap;
          flushBorder = this._transitParams.newSapTimes[i];
        }
      }

      for (i = 0; i < this._transitParams.startupBuffer.length; i++) {
        if (this._transitParams.startupBuffer[i].ts >= flushBorder) break;
      }

      if (i > 0) {
        this._transitParams.startupBuffer.splice(0, i);
        let iData;
        for (let j = 0; j < this._transitParams.initDataBuffer.length; j++) {
          if (this._transitParams.initDataBuffer[j].idx <= i) {
            iData = this._transitParams.initDataBuffer.shift();
            j--;
          } else {
            this._transitParams.initDataBuffer[j].idx -= i;
          }
        }
        if (iData) {
          this._transitParams.composer.setTrackParams(
            this._transitParams.cTrackId,
            { codec: this._transitParams.codec, codecData: iData.data },
          );
          this._transitParams.initSegmentData = iData.data;
          this._transitParams.initSegment =
            this._transitParams.composer.initSegment();
          _processNalUnit(null, iData.data);
        }
      }

      let fCont = this._isFrameContinual(flushBorder);
      _sourceBuffer.pushInit(this._transitParams.initSegment, fCont[0]);
      if (this._transitStarted) {
        let edge = fCont[1];
        this._logger.debug(
          `transit buffer length = ${this._transitParams.startupBuffer.length}`,
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

  _needToCancelCurrentStream(timestamp, isSAP) {
    let result = false;
    let tpLen = this._transitParams.newSapTimes.length;
    if (tpLen > 0) {
      if (_sapAlignment) {
        if (
          isSAP &&
          (timestamp >= this._transitParams.newSapTimes[0] ||
            timestamp >= this._transitParams.newSapTimes[tpLen - 1])
        ) {
          result = true;
        }
      } else {
        if (
          timestamp >=
          this._transitParams.newSapTimes[0] +
            2 * ((_transBuffering * _timescale) / 1000)
        ) {
          this._logger.debug(
            "Cancel current stream, because current timestamp is twice ahead possible buffer of new stream",
            timestamp,
            this._transitParams.newSapTimes[0],
          );
          result = true;
        } else {
          for (
            let i = this._transitParams.newSapTimes.length - 1;
            i >= 0;
            i--
          ) {
            if (
              Math.abs(timestamp - this._transitParams.newSapTimes[i]) <
              _smoothBorder()
            ) {
              this._logger.debug(
                "Cancel current stream. Timestamp " +
                  timestamp +
                  " is near new stream key frame " +
                  this._transitParams.newSapTimes[i],
              );
              result = true;
              break;
            } else if (timestamp > this._transitParams.newSapTimes[i]) {
              break;
            }
          }
        }
      }
    }
    return result;
  }

  _needToSwitchToNewStream(timestamp) {
    let result = false;
    let maxShift = (_transBuffering * _timescale) / 1000;
    let curSapTimesLength = this._transitParams.curSapTimes.length;
    let newSapTimesLength = this._transitParams.newSapTimes.length;
    let tsDiff = timestamp - this._transitParams.startupBuffer[0].ts;
    if (_sapAlignment && TRANSITION_MODE.ABRUPT != this._transitParams.mode) {
      if (tsDiff >= maxShift) {
        if (curSapTimesLength > 0) {
          let curK = 0;
          for (let j = 0; j < curSapTimesLength; j++) {
            if (
              this._transitParams.curSapTimes[j] <
                this._transitParams.newSapTimes[curK] ||
              this._transitParams.curSapTimes[j] <= _lastProcessedTimestamp
            ) {
              continue;
            }
            for (let k = curK; k < newSapTimesLength; k++) {
              curK = k;
              if (
                this._transitParams.newSapTimes[k] >
                this._transitParams.curSapTimes[j]
              ) {
                break;
              } else if (
                this._transitParams.newSapTimes[k] ==
                this._transitParams.curSapTimes[j]
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
        (this._transitParams.newSapTimes[newSapTimesLength - 1] >
          this._transitParams.curSapTimes[0] ||
          this._transitParams.newSapTimes[newSapTimesLength - 1] >=
            this._transitParams.curSapTimes[curSapTimesLength - 1])
      ) {
        this._logger.debug("Switch to new stream SAP alignment does not work!");
        result = true;
      }
    } else if (
      tsDiff >= 2 * maxShift &&
      (timestamp >= this._transitParams.curStreamLastBufferedTs ||
        undefined == this._transitParams.curStreamLastBufferedTs)
    ) {
      this._logger.debug(
        "Switch to new stream because transition buffer is twice filled",
      );
      result = true;
    } else if (tsDiff >= maxShift) {
      if (
        this._transitParams.curStreamCancelled &&
        (timestamp >= this._transitParams.curStreamLastBufferedTs ||
          undefined == this._transitParams.curStreamLastBufferedTs)
      ) {
        this._logger.debug(
          "Switch to new stream because buffer is filled and current stream is cancelled",
        );
        result = true;
      } else {
        for (let i = this._transitParams.newSapTimes.length - 1; i >= 0; i--) {
          if (
            Math.abs(
              this._transitParams.curStreamLastBufferedTs -
                this._transitParams.newSapTimes[i],
            ) < _smoothBorder()
          ) {
            this._logger.debug(
              "Switch to new stream, because new key frame " +
                this._transitParams.newSapTimes[i] +
                " is near to current latest timestamp " +
                this._transitParams.curStreamLastBufferedTs,
            );
            result = true;
            break;
          } else if (
            this._transitParams.curStreamLastBufferedTs >
            this._transitParams.newSapTimes[i]
          ) {
            break;
          }
        }
        if (
          !result &&
          timestamp + 2 * maxShift < this._transitParams.curStreamLastBufferedTs
        ) {
          if (tsDiff >= 10 * _timescale) {
            this._logger.error(
              "Error: new stream is " +
                (this._transitParams.curStreamLastBufferedTs - timestamp) /
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

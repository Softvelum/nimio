import { SharedAudioBuffer } from "./shared-audio-buffer";

let skipCnt = 0;

export class ReadableAudioBuffer extends SharedAudioBuffer {
  read(startTsNs, outputChannels, step = 1) {
    if (outputChannels.length !== this.numChannels) {
      throw new Error("output channels size must match numChannels");
    }
    this.runDeferred();

    let readPrms = this._createReadParams(outputChannels[0].length, step);
    let endTsNs = startTsNs + readPrms.outLength * this._sampleNs * step;
    let tsMarg = this._sampleNs - 10;
    let tsErr = this._sampleNs / 10;

    let skipIdx = null;
    let useFF = step > 1 && this._props.fastForward;
    this.forEach((fStartTs, rate, data, idx, left) => {
      let fStartTsNs = fStartTs * 1000;
      let fEndTsNs = fStartTsNs + this._frameNs;
      if (endTsNs < fStartTsNs) {
        return false; // stop iterating, all frames are later than endTsNs
      }

      if (fStartTsNs - tsMarg < startTsNs && startTsNs < fEndTsNs + tsErr) {
        readPrms.startIdx = idx;
        readPrms.startTsNs = startTsNs;
        readPrms.sfStartTsNs = fStartTsNs;
        readPrms.startRate = rate || 1;
        readPrms.startCount = (this._sampleCount / (rate || 1) + 0.5) >>> 0;
        readPrms.startOffset = this.calcSamplePos(
          startTsNs,
          fStartTsNs,
          readPrms.startCount,
        );
        if (readPrms.startOffset >= readPrms.startCount) {
          console.warn(
            `Start offset is excessive, capping it: startOffset=${readPrms.startOffset}, startCount=${readPrms.startCount}`,
          );
          readPrms.startOffset = readPrms.startCount - 1;
        }
        if (
          useFF &&
          rate !== 1 &&
          rate < readPrms.prelimRate &&
          readPrms.startCount - readPrms.startOffset >= readPrms.outLength
        ) {
          endTsNs =
            startTsNs + (rate || 1) * readPrms.outLength * this._sampleNs;
        }
      }
      if (fStartTsNs < endTsNs && endTsNs < fEndTsNs + tsMarg) {
        readPrms.endIdx = idx;
        readPrms.efStartTsNs = fStartTsNs;
        readPrms.endRate = rate || 1;
        readPrms.endCount = (this._sampleCount / (rate || 1) + 0.5) >>> 0;
        readPrms.endOffset = this.calcSamplePos(
          endTsNs,
          fStartTsNs,
          readPrms.endCount,
        );

        if (readPrms.endOffset > readPrms.endCount) {
          console.warn(
            `End offset exceeds sampleCount, capping it: endOffset=${readPrms.endOffset}, endCount=${readPrms.endCount}`,
          );
          readPrms.endOffset = readPrms.endCount;
        }

        if (readPrms.startIdx === null) {
          readPrms.startTsNs = startTsNs;
          return false; // skip further adjustments
        }

        let readCnt = readPrms.count();
        if (readPrms.prelimRate >= 1 && readCnt < readPrms.outLength) {
          let toRead = readPrms.outLength - readCnt;
          let rest = readPrms.endCount - readPrms.endOffset;
          if (toRead <= rest) {
            readPrms.endOffset += toRead;
          } else if (left > 0) {
            endTsNs = fEndTsNs + (toRead - rest) * this._sampleNs + tsErr;
            readPrms.endOffset = readPrms.endCount;
            skipIdx = idx;
            return true;
          }
        } else if (useFF && readCnt > readPrms.outLength) {
          let extr = readCnt - readPrms.outLength;
          readPrms.endOffset -= extr;
        }

        return false; // range found, stop iterating
      }
      skipIdx = idx;
    });
    if (readPrms.endIdx !== null) {
      const isFinished = readPrms.endOffset === readPrms.endCount;
      this.setReadIdx(isFinished ? readPrms.endIdx + 1 : readPrms.endIdx);
    } else if (readPrms.startIdx !== null) {
      this.setReadIdx(readPrms.startIdx + 1);
    } else if (skipIdx !== null) {
      this.setReadIdx(skipIdx);
      skipCnt++;
      let lastTs = this.lastFrameTs;
      console.error(
        `No frames found in the requested range: ${startTsNs}..${endTsNs}, skipIdx = ${skipIdx}. Size = ${this.getSize()}. Last ts = ${lastTs}, dist=${(lastTs - startTsNs / 1000) / 1000}ms`,
      );
      if (skipCnt > 500) {
        this.halt();
        debugger;
      }
    }
    if (readPrms.endIdx === null) readPrms.endTsNs = endTsNs;

    for (let i = 0; i < this._preprocessors.length; i++) {
      let pRes = this._preprocessors[i].process(readPrms);
      if (!pRes) return 0;
    }

    if (!readPrms.rate) readPrms.rate = readPrms.prelimRate;
    return this._fillOutput(outputChannels, readPrms);
  }

  calcSamplePos(startTsNs, fStartTsNs, sCount) {
    let sRate = (sCount * 1e9) / this._frameNs;
    let res = (startTsNs - fStartTsNs) * sRate;
    if (res < 0) res = 0;
    return (res / 1e9 + 0.5) >>> 0;
  }

  _fillOutput(outputChannels, rParams) {
    let step = this._getReadStep(rParams);

    let processed = null;
    if (rParams.startIdx === rParams.endIdx) {
      if (rParams.startIdx === null || step === 0) {
        for (let c = 0; c < this.numChannels; c++) {
          outputChannels[c].fill(0);
        }
        processed = (rParams.outLength * step + 0.5) >>> 0;
      } else {
        this._copyChannelsData(
          this._frames[rParams.startIdx],
          outputChannels,
          rParams.startOffset,
          rParams.endOffset,
          0,
          step,
        );
        processed = this._calcProcessedSamples(rParams, true);
      }
      return processed;
    }

    let startCount = null;
    if (rParams.startIdx !== null) {
      startCount = this._copyChannelsData(
        this._frames[rParams.startIdx],
        outputChannels,
        rParams.startOffset,
        rParams.startCount,
        0,
        step,
      );
    }

    let endCount = null;
    if (rParams.endIdx !== null) {
      endCount = this._copyChannelsData(
        this._frames[rParams.endIdx],
        outputChannels,
        0,
        rParams.endOffset,
        -1,
        step,
      );
    }

    let fillCount;
    if (startCount === null) {
      fillCount = rParams.outLength - endCount;
      console.error("Fill silence (start)", fillCount);
      if (fillCount > 70) {
        this.halt();
        console.log(`Read idx = ${this.getReadIdx()}, writeIdx = ${this.getWriteIdx()}`);
        debugger;
      }
      this._fillSilence(outputChannels, 0, fillCount);
    } else if (endCount === null) {
      fillCount = rParams.outLength - startCount;
      console.error("Fill silence (end)", fillCount);
      if (fillCount > 70) {
        this.halt();
        console.log(`Read idx = ${this.getReadIdx()}, writeIdx = ${this.getWriteIdx()}`);
        debugger;
      }
      this._fillSilence(outputChannels, startCount, fillCount);
    } else if (startCount + endCount < rParams.outLength) {
      fillCount = rParams.outLength - startCount - endCount;
      console.error("Fill silence (middle)", fillCount);
      if (fillCount > 70) {
        this.halt();
        console.log(`Read idx = ${this.getReadIdx()}, writeIdx = ${this.getWriteIdx()}`);
        debugger;
      }
      this._fillSilence(outputChannels, startCount, fillCount);
    }

    return this._calcProcessedSamples(rParams);
  }

  _getReadStep(rParams) {
    let step = rParams.rate;
    if (rParams.startIdx === null || rParams.endIdx === null || step === 0) {
      return step;
    }

    let expProcCnt = rParams.endOffset - rParams.startOffset;
    if (rParams.startIdx !== rParams.endIdx) {
      expProcCnt += rParams.startCount;
    }
    let steppedCount = (expProcCnt / step + 0.5) >>> 0;
    if (steppedCount < rParams.outLength) {
      let curStep = step;
      step = expProcCnt / rParams.outLength;
      if (step > 0 && step < 0.9) step = 0.9;
      console.log(
        `Fixed step from ${curStep} to ${step}, start=(${rParams.startIdx}, ${rParams.startOffset}), end=(${rParams.endIdx}, ${rParams.endOffset}), srate=${rParams.startRate}, erate=${rParams.endRate}, scount = ${rParams.startCount}, expected count: ${expProcCnt}, stepped count: ${steppedCount}`,
      );
    }

    return step;
  }

  _calcSampleTs(offset, fStartTsNs, sCount) {
    return (offset * this._frameNs) / sCount + fStartTsNs;
  }

  _calcProcessedSamples(rp, isSingleFrame) {
    let endTsNs = rp.endTsNs;
    if (!endTsNs) {
      let frameStart = isSingleFrame ? rp.sfStartTsNs : rp.efStartTsNs;
      let sCount = isSingleFrame ? rp.startCount : rp.endCount;
      endTsNs = this._calcSampleTs(rp.endOffset, frameStart, sCount);
    }
    return ((endTsNs - rp.startTsNs) / this._sampleNs + 0.5) >>> 0;
  }

  _fillSilence(outputChannels, startIdx, count) {
    for (let c = 0; c < this.numChannels; c++) {
      const channelData = outputChannels[c];
      let chIdx = startIdx;
      for (let i = 0; i < count; i++) {
        channelData[chIdx++] = 0;
      }
    }
  }

  _copyChannelsData(data, outputChannels, startIdx, endIdx, offset, step) {
    let copiedCount = 0;
    let channelShift = 0;
    let dtLength = endIdx - startIdx;
    if (step < 1) dtLength = ((dtLength + 1) / step + 0.5) >>> 0;
    for (let c = 0; c < this.numChannels; c++) {
      const channelData = outputChannels[c];
      const chLen = channelData.length;
      if (offset >= 0) {
        let chIdx = offset;
        for (let i = 0; i < dtLength; i++) {
          let dtIdx = startIdx + (((offset + i) * step - offset) >>> 0);
          if (dtIdx >= endIdx || chIdx >= chLen) break;

          channelData[chIdx++] = data[channelShift + dtIdx];
        }
        copiedCount = chIdx - offset;
      } else {
        let rOffset = -offset - 1;
        let chIdx = channelData.length - rOffset - 1;
        for (let i = 0; i < dtLength; i++) {
          let dtIdx = endIdx - 1 - (((rOffset + i) * step - rOffset) >>> 0);
          if (dtIdx < startIdx || chIdx < 0) break;

          channelData[chIdx--] = data[channelShift + dtIdx];
        }
        copiedCount = channelData.length - rOffset - chIdx - 1;
      }
      channelShift += this._sampleCount;
    }

    return copiedCount;
  }

  _createReadParams(outLength, rate) {
    return {
      startIdx: null,
      endIdx: null,
      prelimRate: rate,
      outLength,
      count: function (useRate) {
        let res = 0;
        if (this.startIdx === this.endIdx && this.startIdx !== null) {
          res = this.endOffset - this.startOffset;
          if (useRate) res *= this.startRate;
        } else {
          if (this.startIdx !== null) {
            res = this.startCount - this.startOffset;
            if (useRate) res *= this.startRate;
          }
          if (this.endIdx !== null) {
            res += useRate ? this.endOffset * this.endRate : this.endOffset;
          }
        }
        return res;
      },
    };
  }
}

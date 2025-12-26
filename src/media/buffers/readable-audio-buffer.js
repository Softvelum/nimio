import { SharedAudioBuffer } from "./shared-audio-buffer";

export class ReadableAudioBuffer extends SharedAudioBuffer {
  #prevPrms = {};

  read(startTsNs, outputChannels, step = 1.0) {
    if (outputChannels.length !== this.numChannels) {
      throw new Error("output channels size must match numChannels");
    }

    let readPrms = this._createReadParams(outputChannels[0].length, step);
    let endTsNs = startTsNs + readPrms.outLength * this.sampleNs * step;
    let tsMarg = this.sampleNs - 10;
    let tsErr = this.sampleNs / 10;

    let skipIdx = null;
    let useFF = (step > 1) && this._props.fastForward;
    this.forEach((fStartTs, rate, data, idx, left) => {
      let fStartTsNs = fStartTs * 1000;
      let fEndTsNs = fStartTsNs + this.frameNs;
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
        if (
          useFF && rate !== 1 && rate < readPrms.prelimRate &&
          readPrms.startCount - readPrms.startOffset >= readPrms.outLength
        ) {
          endTsNs = startTsNs + (rate || 1) * readPrms.outLength * this.sampleNs;
        }
      }
      if (fStartTsNs < endTsNs && endTsNs < fEndTsNs + tsMarg) {
        readPrms.endIdx = idx;
        readPrms.endTsNs = endTsNs;
        readPrms.efStartTsNs = fStartTsNs;
        readPrms.endRate = rate || 1;
        readPrms.endCount = (this._sampleCount / (rate || 1) + 0.5) >>> 0;
        readPrms.endOffset = this.calcSamplePos(
          endTsNs,
          fStartTsNs,
          readPrms.endCount,
        );

        if (readPrms.extend) {
          console.log(`Set extended offset ${readPrms.endOffset} for idx=${readPrms.endIdx}`);
        }

        if (isNaN(readPrms.endOffset) || readPrms.startIdx === null) {
          debugger;
        }

        if (readPrms.endOffset > readPrms.endCount) {
          console.warn(`End offset exceeds sampleCount, capping it: endOffset=${readPrms.endOffset}, endCount=${readPrms.endCount}`);
          readPrms.endOffset = readPrms.endCount;
        }

        if (readPrms.startIdx === null) return false; // skip further adjustments

        let readCnt = readPrms.count();
        if (readPrms.prelimRate >= 1 && readCnt < readPrms.outLength) {
          let toRead = readPrms.outLength - readCnt;
          let rest = readPrms.endCount - readPrms.endOffset;
          if (toRead <= rest) {
            readPrms.endOffset += toRead;
            readPrms.endTsNs += toRead * this.sampleNs * readPrms.endRate;
          } else if (left > 0) {
            endTsNs += this.sampleNs * (rest * (readPrms.endRate - 1) + toRead);
            console.log(`Increase endTsNs by ${toRead} samples, rest=${rest}`);
            readPrms.extend = true;
            skipIdx = idx;
            return true;
          }
        } else if (useFF && readCnt > readPrms.outLength) {
          let extr = readCnt - readPrms.outLength;
          readPrms.endOffset -= extr;
          readPrms.endTsNs -= extr * this.sampleNs * readPrms.endRate;
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
      console.error(
        `No frames found in the requested range: ${startTsNs}..${endTsNs}`,
      );
    }

    for (let i = 0; i < this._preprocessors.length; i++) {
      let pRes = this._preprocessors[i].process(readPrms);
      if (!pRes) return 0;
    }

    if (this.#prevPrms.endOffset !== readPrms.startOffset && this.#prevPrms.endOffset !== undefined && this.#prevPrms.endOffset !== this.#prevPrms.endCount) {
      console.log(`prev frame start idx=${this.#prevPrms.startIdx}, off=${this.#prevPrms.startOffset}, end idx=${this.#prevPrms.endIdx}, off=${this.#prevPrms.endOffset}, count=${this.#prevPrms.endCount}, startTs=${this.#prevPrms.startTsNs / 1000}, endTs=${this.#prevPrms.endTsNs / 1000}`);
      console.log(`read start idx=${readPrms.startIdx}, off=${readPrms.startOffset}, end idx=${readPrms.endIdx}, off=${readPrms.endOffset}, count=${readPrms.endCount}, startTs = ${startTsNs / 1000}, endTs  = ${endTsNs / 1000}`);
      console.log(`diff samples = ${(startTsNs - this.#prevPrms.startTsNs) / this.sampleNs}`);
    }

    this.#prevPrms.startIdx = readPrms.startIdx;
    this.#prevPrms.endIdx = readPrms.endIdx;
    this.#prevPrms.startOffset = readPrms.startOffset;
    this.#prevPrms.endOffset = readPrms.endOffset;
    this.#prevPrms.startTsNs = startTsNs;
    this.#prevPrms.endTsNs = endTsNs;
    this.#prevPrms.endCount = readPrms.endCount;

    // if (readPrms.startIdx === readPrms.endIdx && readPrms.endOffset - readPrms.startOffset > 128) {
    //   debugger;
    // }

    if (!readPrms.rate) readPrms.rate = readPrms.prelimRate;

    return this._fillOutput(outputChannels, readPrms);
  }

  calcSamplePos(startTsNs, fStartTsNs, sCount) {
    let sRate = sCount * 1e9 / this.frameNs;
    let res = (startTsNs - fStartTsNs) * sRate;
    if (res < 0) res = 0;
    return (res / 1e9 + 0.5) >>> 0;
  }

  calcSampleTs(offset, fStartTsNs, sCount) {
    let sRate = sCount * 1e9 / this.frameNs;
    let res = offset * this.frameNs / sCount + fStartTsNs;
    return res;
  }

  _fillOutput(outputChannels, rParams) {
    let step = rParams.rate;
    let outLength = rParams.outLength;
    if (rParams.startIdx !== null && rParams.endIdx !== null) {
      let expProcCnt = rParams.endOffset - rParams.startOffset;
      if (rParams.startIdx !== rParams.endIdx) {
        expProcCnt += rParams.startCount;
      }
      if (expProcCnt !== 128) {
        debugger;
      }
      let steppedCount = (expProcCnt / step + 0.5) >>> 0;
      if (steppedCount < outLength) {
        let prevStep = step;
        step = expProcCnt / outLength;
        if (step < 0.95) step = 0.95;
        console.log(
          `Fixed step from ${prevStep} to ${step}, start=${rParams.startOffset}, end=${rParams.endOffset}, srate=${rParams.startRate}, erate=${rParams.endRate}, scount = ${rParams.startCount}, expected count: ${expProcCnt}, stepped count: ${steppedCount}`,
        );
      }
    }

    let processed = null;
    if (rParams.startIdx === rParams.endIdx) {
      if (rParams.startIdx === null) {
        for (let c = 0; c < this.numChannels; c++) {
          outputChannels[c].fill(0);
        }
        processed = (outLength * step + 0.5) >>> 0;
      } else {
        this._copyChannelsData(
          this._frames[rParams.startIdx],
          outputChannels,
          rParams.startOffset,
          rParams.endOffset,
          0,
          step,
        );
        processed = rParams.endOffset - rParams.startOffset;
        processed = (processed * rParams.startRate + 0.5) >>> 0;
      }
    }
    if (processed !== null) {
      // if (processed > 128) {
      //   console.warn(`Processed ${processed}, idx=${rParams.startIdx}, start off=${rParams.startOffset}, end off=${rParams.endOffset}, cnt=${rParams.startCount}, rate=${rParams.startRate}`);
      // }
      let endTsNs = this.calcSampleTs(rParams.endOffset, rParams.sfStartTsNs, rParams.startCount);
      let altProcessed = ((endTsNs - rParams.startTsNs) / this.sampleNs + 0.5) >>> 0;
      // if (altProcessed !== processed) {
      //   console.warn(`Alt processed = ${altProcessed}, processed = ${processed}`);
      // }
      if (altProcessed > 10000) {
        debugger;
      }
      return altProcessed;
    }

    processed = 0;
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
      processed = (rParams.startCount - rParams.startOffset) * rParams.startRate;
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
      processed += rParams.endOffset * rParams.endRate;
      processed = (processed + 0.5) >>> 0;
    }

    if (startCount === null) {
      console.error("Fill silence (start)", outLength - endCount);
      this._fillSilence(outputChannels, 0, outLength - endCount);
      processed += outLength - endCount;
    } else if (endCount === null) {
      console.error("Fill silence (end)", outLength - startCount);
      this._fillSilence(outputChannels, startCount, outLength - startCount);
      processed += outLength - startCount;
    } else if (startCount + endCount < outLength) {
      console.error("Fill silence (middle)", outLength - startCount - endCount);
      this._fillSilence(
        outputChannels,
        startCount,
        outLength - startCount - endCount,
      );
      processed += outLength - startCount - endCount;
    }

    // if (processed > 128) {
    //   console.warn(`Processed ${processed}, idx=${rParams.startIdx}, off=${rParams.startOffset}, end idx=${rParams.endIdx}, off=${rParams.endOffset}, start cnt=${rParams.startCount}, startRate=${rParams.startRate}, endRate=${rParams.endRate}`);
    // }
    let endTsNs = this.calcSampleTs(rParams.endOffset, rParams.efStartTsNs, rParams.endCount);
    let altProcessed = ((endTsNs - rParams.startTsNs) / this.sampleNs + 0.5) >>> 0;
    // if (altProcessed !== processed) {
    //   console.warn(`Alt 2 processed = ${altProcessed}, processed = ${processed}`);
    // }
    if (altProcessed > 10000) {
      debugger;
    }

    return altProcessed;
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

  _createReadParams (outLength, rate) {
    return {
      startIdx: null,
      endIdx: null,
      prelimRate: rate,
      outLength,
      count: function(useRate) {
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
      }
    };
  }
}

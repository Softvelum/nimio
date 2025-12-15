import { SharedAudioBuffer } from "./shared-audio-buffer";

export class ReadableAudioBuffer extends SharedAudioBuffer {
  read(startTsNs, endTsNs, outputChannels, step = 1.0) {
    if (outputChannels.length !== this.numChannels) {
      throw new Error("output channels size must match numChannels");
    }

    let readPrms = {
      startIdx: null,
      endIdx: null,
      rate: step,
      outLength: outputChannels[0].length,
    };
    let skipIdx = null;
    this.forEach((fStartTs, rate, data, idx, left) => {
      let fStartTsNs = fStartTs * 1000;
      let fEndTsNs = fStartTsNs + this.frameNs;
      if (endTsNs < fStartTsNs) {
        return false; // stop iterating, all frames are later than endTsNs
      }

      if (fStartTsNs - this.sampleNs / 4 <= startTsNs && startTsNs < fEndTsNs) {
        readPrms.startIdx = idx;
        readPrms.startTsNs = startTsNs;
        readPrms.sfStartTsNs = fStartTsNs;
        readPrms.startRate = rate;
        readPrms.startCount = (this._sampleCount / rate + 0.5) >>> 0;
        readPrms.startOffset = this.calcSamplePos(
          startTsNs,
          fStartTsNs,
          readPrms.startCount,
        );
      }
      if (fStartTsNs < endTsNs && endTsNs <= fEndTsNs + this.sampleNs / 4) {
        readPrms.endIdx = idx;
        readPrms.endTsNs = endTsNs;
        readPrms.efStartTsNs = fStartTsNs;
        readPrms.endRate = rate;
        readPrms.endCount = (this._sampleCount / rate + 0.5) >>> 0;
        readPrms.endOffset = this.calcSamplePos(
          endTsNs,
          fStartTsNs,
          readPrms.endCount,
        );
        // TODO: this seems like never happens, but need some time to check
        // Double-check this later if this situation is possible
        if (readPrms.endOffset > readPrms.endCount) {
          console.error("End offset exceeds sampleCount, capping it");
          readPrms.endOffset = readPrms.endCount;
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

    return this._fillOutput(outputChannels, readPrms);
  }

  calcSamplePos(startTsNs, fStartTsNs, sCount) {
    let sRate = sCount * 1e9 / this.frameNs;
    let res = (startTsNs - fStartTsNs) * sRate;
    if (res < 0) res = 0;
    return (res / 1e9 + 0.5) >>> 0;
  }

  _fillOutput(outputChannels, rParams) {
    let step = rParams.rate;
    let outLength = rParams.outLength;
    if (rParams.startIdx !== null && rParams.endIdx !== null) {
      let expProcCnt = rParams.endOffset - rParams.startOffset;
      if (rParams.startIdx !== rParams.endIdx) {
        expProcCnt += rParams.startCount;
      }
      let steppedCount = (expProcCnt / step + 0.5) >>> 0;
      if (steppedCount < outLength) {
        let prevStep = step;
        step = expProcCnt / outLength;
        if (step < 0.95) step = 0.95;
        console.log(
          `Fixed step from ${prevStep} to ${step}, expected count: ${expProcCnt}, stepped count: ${steppedCount}`,
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
    if (processed !== null) return processed;

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
    } else if (endCount === null) {
      console.error("Fill silence (end)", outLength - startCount);
      this._fillSilence(outputChannels, startCount, outLength - startCount);
    } else if (startCount + endCount < outLength) {
      console.error("Fill silence (middle)", outLength - startCount - endCount);
      this._fillSilence(
        outputChannels,
        startCount,
        outLength - startCount - endCount,
      );
    }

    return processed;
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
}

import { SharedAudioBuffer } from "./shared-audio-buffer.js";

export class ReadableAudioBuffer extends SharedAudioBuffer {
  read(startTsNs, endTsNs, outputChannels, step = 1.0) {
    if (outputChannels.length !== this.numChannels) {
      throw new Error("outputChannels must match numChannels");
    }

    let readStartIdx = null;
    let readEndIdx = null;
    let readStartOffset = null;
    let readEndOffset = null;
    let skipIdx = null;
    this.forEach((frameStartTs, data, idx, left) => {
      let frameStartTsNs = frameStartTs * 1000;
      let frameEndTsNs = frameStartTsNs + this.frameNs;
      if (endTsNs < frameStartTsNs) {
        return false; // stop iterating, all frames are later than endTsNs
      }

      if (
        frameStartTsNs - this.sampleNs / 4 <= startTsNs &&
        startTsNs < frameEndTsNs
      ) {
        readStartIdx = idx;
        readStartOffset = (startTsNs - frameStartTsNs) * this.sampleRate;
        if (readStartOffset < 0) readStartOffset = 0;
        readStartOffset = (readStartOffset / 1e9 + 0.5) >>> 0;
      }
      if (
        frameStartTsNs < endTsNs &&
        endTsNs <= frameEndTsNs + this.sampleNs / 4
      ) {
        readEndIdx = idx;
        readEndOffset = (endTsNs - frameStartTsNs) * this.sampleRate;
        readEndOffset = (readEndOffset / 1e9 + 0.5) >>> 0;
        if (readEndOffset > this.sampleCount) {
          readEndOffset = this.sampleCount;
        }
        return false; // range found, stop iterating
      }
      skipIdx = idx;
    });
    if (readEndIdx !== null) {
      this.setReadIdx(
        readEndOffset === this.sampleCount ? readEndIdx + 1 : readEndIdx,
      );
    } else if (readStartIdx !== null) {
      this.setReadIdx(readStartIdx + 1);
    } else if (skipIdx !== null) {
      this.setReadIdx(skipIdx);
      console.warn("No frames found in the requested range");
    }

    return this._fillOutput(
      outputChannels,
      readStartIdx,
      readEndIdx,
      readStartOffset,
      readEndOffset,
      step,
    );
  }

  _fillOutput(outputChannels, startIdx, endIdx, startOffset, endOffset, step) {
    let processed = null;
    if (startIdx === endIdx) {
      if (startIdx === null) {
        for (let c = 0; c < this.numChannels; c++) {
          outputChannels[c].fill(0);
        }
        processed = 0;
      } else {
        this._copyChannelsData(
          this.frames[startIdx],
          outputChannels,
          startOffset,
          endOffset,
          0,
          step,
        );
        processed = endOffset - startOffset;
      }
    }
    if (processed !== null) return processed;

    processed = 0;
    let startCount = null;
    if (startIdx !== null) {
      startCount = this._copyChannelsData(
        this.frames[startIdx],
        outputChannels,
        startOffset,
        this.sampleCount,
        0,
        step,
      );
      processed = this.sampleCount - startOffset;
    }

    let endCount = null;
    if (endIdx !== null) {
      endCount = this._copyChannelsData(
        this.frames[endIdx],
        outputChannels,
        0,
        endOffset,
        -1,
        step,
      );
      processed += endOffset;
    }

    if (startCount === null) {
      console.warn(
        "Fill silence at the start",
        outputChannels[0].length - endCount,
      );
      this._fillSilence(outputChannels, 0, outputChannels[0].length - endCount);
    } else if (endCount === null) {
      console.warn(
        "Fill silence at the end",
        outputChannels[0].length - startCount,
      );
      this._fillSilence(
        outputChannels,
        startCount,
        outputChannels[0].length - startCount,
      );
    } else if (startCount + endCount < outputChannels[0].length) {
      console.warn(
        "Fill silence in the middle",
        outputChannels[0].length - startCount - endCount,
      );
      this._fillSilence(
        outputChannels,
        startCount,
        outputChannels[0].length - startCount - endCount,
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
    const dtLength = endIdx - startIdx;
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
      channelShift += this.sampleCount;
    }

    return copiedCount;
  }
}

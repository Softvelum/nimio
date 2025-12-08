const WEBAUDIO_BLOCK_SIZE = 128;

function makeHannWindow(N) {
  let win = new Float32Array(N);
  for (var n = 0; n < N; n++) {
    win[n] = 0.5 * (1 - Math.cos(2 * Math.PI * n / N));
  }

  return win;
}

function applyHannWindow(input, N, window) {
  for (var n = 0; n < N; n++) {
    input[n] *= window[n];
  }
}

function dotProduct(a, aOff, b, bOff, length) {
  let res = 0;
  for (let i = 0; i < length; i++) {
    res += a[aOff + i] * b[bOff + i];
  }
  return res;
}

function l2EnergyArraySegment(arr, offset, length) {
  let res = 0;
  for (let i = 0; i < length; i++) {
    const v = arr[offset + i];
    res += v * v;
  }

  return res;
}

function nccScore(ref, view, L) {
  let num = 0;
  let eRef = 0;
  let eView = 0;

  for (let i = 0; i < L; i++) {
    const r = ref[i];
    const v = view[i];
    num += r * v;
    eRef += r * r;
    eView += v * v;
  }
  const denom = Math.sqrt(eRef * eView) || 1e-12;

  return num / denom;
}

class Wsola {
  constructor(opts) {

    this.blockSize = opts.blockSize || 1024;
    this.webAudioBlockSize = opts.webAudioBlockSize || 128;

    this.hopAnalysis = opts.hopAnalysis || Math.floor(this.blockSize / 2); // Ha
    this.targetSpeed = (typeof opts.speed === 'number') ? opts.speed : 1.0;
    this.currentSpeed = this.targetSpeed;
    this.smoothingFactor = (typeof opts.smoothingFactor === 'number') ? opts.smoothingFactor : 0.02; // 0..1

    if (this.smoothingFactor < 0) this.smoothingFactor = 0;
    if (this.smoothingFactor > 0.5) this.smoothingFactor = 0.5;

    this.hopSynthesis = Math.max(1, Math.round(this.hopAnalysis / Math.max(0.01, this.currentSpeed)));

    // NCC search
    this.searchRadius = typeof opts.searchRadius === 'number' ? Math.max(1, Math.floor(opts.searchRadius)) : Math.max(1, Math.floor(0.02 * (opts.sampleRate || sampleRate))); // default 20ms
    this.searchCoarseStep = opts.coarseStep || 4;

    const marginFrames = 4;
    this.ringCapacity = this.blockSize + this.webAudioBlockSize * marginFrames;

    this.nbInputs = options.numberOfInputs || 1;
    this.nbOutputs = options.numberOfOutputs || 1;

    this.inputRings = new Array(this.nbInputs);
    this.outputRings = new Array(this.nbOutputs);
    this.inputChannelCounts = new Array(this.nbInputs).fill(1);
    this.outputChannelCounts = new Array(this.nbOutputs).fill(1);

    for (let p = 0; p < this.nbInputs; p++) this._allocInputPort(p, 1);
    for (let p = 0; p < this.nbOutputs; p++) this._allocOutputPort(p, 1);

    this.window = new Float32Array(this.blockSize);
    for (let n = 0; n < this.blockSize; n++) this.window[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (this.blockSize - 1)));


    this.frameTmp = new Float32Array(this.blockSize);
    this.overlapRef = new Float32Array(Math.floor(this.hopAnalysis));
    this.overlapCand = new Float32Array(Math.floor(this.hopAnalysis));

    this.analysisPtr = 0;
    this.synthesisPtr = 0;

    this.debugEnabled = false;
    this.debugSendIntervalFrames = opts.debugSendIntervalFrames || 40;
    this._debugFrameCounter = 0;
    this.debugWaveSamples = Math.min(128, Math.floor(this.hopAnalysis));
  }

  _allocInputPort(portIndex, nbChannels) {
    this.inputChannelCounts[portIndex] = nbChannels;
    this.inputRings[portIndex] = new Array(nbChannels);
    for (let ch = 0; ch < nbChannels; ch++) this.inputRings[portIndex][ch] = new SimpleRingBuffer(this.ringCapacity);
  }

  _allocOutputPort(portIndex, nbChannels) {
    this.outputChannelCounts[portIndex] = nbChannels;
    this.outputRings[portIndex] = new Array(nbChannels);
    for (let ch = 0; ch < nbChannels; ch++) this.outputRings[portIndex][ch] = new SimpleRingBuffer(this.ringCapacity);
  }

  reallocateChannels(inputs, outputs) {
    for (let p = 0; p < this.nbInputs; p++) {
      const nb = (inputs[p] && inputs[p].length) ? inputs[p].length : 0;
      if (nb !== this.inputChannelCounts[p]) this._allocInputPort(p, Math.max(1, nb || 1));
    }
    for (let p = 0; p < this.nbOutputs; p++) {
      const nb = (outputs[p] && outputs[p].length) ? outputs[p].length : 0;
      if (nb !== this.outputChannelCounts[p]) this._allocOutputPort(p, Math.max(1, nb || 1));
    }
  }

  _writeInputs(inputs) {
    const we = this.webAudioBlockSize;
    for (let p = 0; p < this.nbInputs; p++) {
      const inPort = inputs[p] || [];
      const rings = this.inputRings[p];
      for (let ch = 0; ch < rings.length; ch++) {
        const block = inPort[ch];
        if (!block || block.length === 0) {
          if (!this._zeroBlock) this._zeroBlock = new Float32Array(we);
          rings[ch].write(this._zeroBlock);
        } else {
          rings[ch].write(block);
        }
      }
    }
  }

  _readOutputs(outputs) {
    const we = this.webAudioBlockSize;
    for (let p = 0; p < this.nbOutputs; p++) {
      const outPort = outputs[p] || [];
      const rings = this.outputRings[p];
      for (let ch = 0; ch < rings.length; ch++) {
        const dest = outPort[ch];
        if (!dest) continue;
        rings[ch].copyInto(rings[ch].getReadIndex(), dest, we);
        rings[ch].advanceRead(we);
      }
    }
  }

  _produceWSOLAFrame() {
    const primaryIn = this.inputRings[0][0];
    const available = primaryIn.availableRead();
    if (available < this.blockSize + this.hopAnalysis) return false;

    this.currentSpeed += (this.targetSpeed - this.currentSpeed) * this.smoothingFactor;
    this.hopSynthesis = Math.max(1, Math.round(this.hopAnalysis / Math.max(0.01, this.currentSpeed)));

    const L = this.hopSynthesis;

    // prepare reference overlap. If no output yet, use zeros.
    const outPrimary = this.outputRings[0][0];
    // reference start = writeIndex - L
    const refWriteIdx = outPrimary.getWriteIndex();
    const refStart = Math.max(0, refWriteIdx - L);
    // Try contiguous view; if not, copy into overlapRef
    const refView = outPrimary.viewContiguous(refStart, L);
    if (refView) {
      // copy refView into overlapRef
      this.overlapRef.set(refView.subarray(0, L));
    } else {
      outPrimary.copyInto(refStart, this.overlapRef, L);
    }

    // search window bounds
    const targetPos = this.analysisPtr;
    const start = Math.max(0, targetPos - this.searchRadius);
    const maxValidStart = primaryIn.getWriteIndex() - this.blockSize;
    const end = Math.min(maxValidStart, targetPos + this.searchRadius);
    if (end < start) return false;

    // coarse NCC search
    const step = Math.max(1, this.searchCoarseStep);
    let bestPos = start;
    let bestScore = -Infinity;

    // coarse pass
    for (let pos = start; pos <= end; pos += step) {
      const view = primaryIn.viewContiguous(pos, L);
      if (view) {
        const s = this._nccScore(this.overlapRef, view, L);
        if (s > bestScore) { bestScore = s; bestPos = pos; }
      } else {
        primaryIn.copyInto(pos, this.overlapCand, L);
        const s = this._nccScore(this.overlapRef, this.overlapCand, L);
        if (s > bestScore) { bestScore = s; bestPos = pos; }
      }
    }

    // fine pass
    const fineStart = Math.max(start, bestPos - step);
    const fineEnd = Math.min(end, bestPos + step);
    for (let pos = fineStart; pos <= fineEnd; pos++) {
      const view = primaryIn.viewContiguous(pos, L);
      if (view) {
        const s = this._nccScore(this.overlapRef, view, L);
        if (s > bestScore) { bestScore = s; bestPos = pos; }
      } else {
        primaryIn.copyInto(pos, this.overlapCand, L);
        const s = this._nccScore(this.overlapRef, this.overlapCand, L);
        if (s > bestScore) { bestScore = s; bestPos = pos; }
      }
    }

    // read full frame at bestPos
    const frameView = primaryIn.viewContiguous(bestPos, this.blockSize);
    if (frameView) {
      this.frameTmp.set(frameView);
    } else {
      primaryIn.copyInto(bestPos, this.frameTmp, this.blockSize);
    }

    for (let i = 0; i < this.blockSize; i++) this.frameTmp[i] *= this.window[i];

    for (let p = 0; p < this.nbOutputs; p++) {
      const outRings = this.outputRings[p];
      for (let ch = 0; ch < outRings.length; ch++) {
        outRings[ch].writeAt(this.synthesisPtr, this.frameTmp);
      }
    }

    this.analysisPtr += this.hopAnalysis;
    this.synthesisPtr += this.hopSynthesis;

    if (this.debugEnabled) {
      this._debugFrameCounter++;
      if (this._debugFrameCounter >= this.debugSendIntervalFrames) {
        this._debugFrameCounter = 0;
        const copyLen = Math.min(this.debugWaveSamples, L);
        const sendRef = new Float32Array(copyLen);
        const sendCand = new Float32Array(copyLen);
        sendRef.set(this.overlapRef.subarray(0, copyLen), 0);
        // candidate overlap at bestPos
        primaryIn.copyInto(bestPos, this.overlapCand, L);
        sendCand.set(this.overlapCand.subarray(0, copyLen), 0);

        // Build debug object and transfer buffers
        const debugObj = {
          type: 'wsola_ncc_debug',
          timestamp: currentTime ?? Date.now(),
          currentSpeed: this.currentSpeed,
          targetSpeed: this.targetSpeed,
          bestPos,
          bestScore,
          analysisPtr: this.analysisPtr,
          synthesisPtr: this.synthesisPtr,
          refSamples: sendRef.buffer,
          candSamples: sendCand.buffer
        };
      }
    }

    return true;
  }

  process(inputs, outputs, parameters) {
    this.reallocateChannels(inputs, outputs);

    // compute how many WSOLA frames heuristic
    const framesToAttempt = Math.max(1, Math.floor((this.webAudioBlockSize * (this.blockSize / Math.max(1, this.hopSynthesis))) || 1));

    for (let i = 0; i < framesToAttempt; i++) {
      if (!this._produceWSOLAFrame()) break;
    }

    this._readOutputs(outputs);

    return true;
  }
}

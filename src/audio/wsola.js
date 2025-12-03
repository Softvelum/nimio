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


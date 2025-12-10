export class AudioWsolaNormCache {
  #hsList = [];
  #arrays = [];
  #usage = [];
  #maxSize = 10;
  #frameLen = 1024;
  #hWin;

  constructor(frameLen, hannWindow, maxSize = 10) {
    this.#maxSize = maxSize;
    this.#frameLen = frameLen;
    this.#hWin = hannWindow;
  }

  getNorm(hs) {
    for (let i = 0; i < this.#hsList.length; i++) {
      if (this.#hsList[i] === hs) {
        this.#usage[i]++;
        return this.#arrays[i];
      }
    }

    let normArray;
    if (this.#hsList.length < this.#maxSize) {
      normArray = this.#computeNorm(hs);
      this.#hsList.push(hs);
      this.#arrays.push(normArray);
      this.#usage.push(1);
    } else {
      let minIdx = 0;
      for (let i = 1; i < this.#usage.length; i++) {
        if (this.#usage[i] < this.#usage[minIdx]) minIdx = i;
      }

      this.#hsList[minIdx] = hs;
      this.#usage[minIdx] = 1;
      normArray = this.#computeNorm(hs, minIdx);
    }

    return normArray;
  }

  #computeNorm(hs, idx) {
    let arr = idx >= 0 ? this.#arrays[idx] : new Float32Array(this.#frameLen);

    return arr;
  }
}

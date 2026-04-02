export class BitReader {
  constructor() {
    this._reset();
  }

  attach(bytes, initialIndex) {
    this._bytes = bytes;
    this._reset();
    if (initialIndex !== undefined) {
      this._index = initialIndex;
    }
  }

  skipBits(count) {
    this._fillBuffer(count);
    if (this._bitsInBuffer < count) {
      return this._insufficientBufferError(count);
    }

    this._bitsInBuffer -= count;
  }

  readBits(count) {
    if (count > 32) {
      console.error("readBits reads up to 32 bits");
      return 0;
    }

    // current buffer can contain up to 7 bits of previously filled data
    if (this._bitsInBuffer + count > 32) {
      this._leftOver = { buf: this._bitBuffer, bits: this._bitsInBuffer };
      this._bitBuffer = this._bitsInBuffer = 0;
    }

    this._fillBuffer(count);

    if (this._bitsInBuffer < count) {
      this._insufficientBufferError(count);
      return 0;
    }

    let res = 0;
    if (this._leftOver) {
      count -= this._leftOver.bits;
      res = this._leftOver.buf << count;
      this._leftOver = null;
    }

    this._bitsInBuffer -= count;
    let mask = count < 32 ? ((1 << count) - 1) >>> 0 : 0xffffffff;
    res += (this._bitBuffer >>> this._bitsInBuffer) & mask;
    return res;
  }

  readUE() {
    let leadingZeroBits = 0;
    while (this.readBits(1) === 0) {
      leadingZeroBits++;
      if (leadingZeroBits > 32) {
        console.error("readUE failed ", this._index, this._bitsInBuffer);
        return 0;
      }
    }
    let codeNum = (1 << leadingZeroBits) - 1 + this.readBits(leadingZeroBits);
    return codeNum;
  }

  readSE() {
    const value = this.readUE();
    if (value & 0x01) {
      return (value + 1) >> 1;
    } else {
      return -(value >> 1);
    }
  }

  _reset() {
    this._index = 0;
    this._bitBuffer = this._bitsInBuffer = 0;
  }

  _fillBuffer(count) {
    while (this._bitsInBuffer < count && this._index < this._bytes.length) {
      this._bitBuffer = (this._bitBuffer << 8) | this._bytes[this._index++];
      this._bitsInBuffer += 8;
    }
  }

  _insufficientBufferError(count) {
    console.error(
      `not enough data to read ${count} bits. Only ${this._bitsInBuffer} available.`,
    );
  }
}

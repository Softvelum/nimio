export class BitReader {
  constructor() {
    this._reset();
  }

  attach(bytes, initialIndex = 0) {
    this._bytes = bytes;
    this._reset();
    this._index = initialIndex;
  }

  readBits(count) {
    if (count === 0) return 0;
    if (count > 32) {
      console.error("readBits reads up to 32 bits");
      return null;
    }

    if (this._availableBits() < count) {
      this._insufficientBufferError("read", count);
      return null;
    }

    // Fast path
    if (this._bitsInBuffer >= count) {
      this._bitsInBuffer -= count;
      return (this._bitBuffer >>> this._bitsInBuffer) & this._maskFor(count);
    }

    // Slow path (split read)
    let res = 0;

    if (this._bitsInBuffer > 0) {
      res = this._bitBuffer & this._maskFor(this._bitsInBuffer);
      count -= this._bitsInBuffer;
      this._bitBuffer = 0;
      this._bitsInBuffer = 0;
    }

    this._fillBuffer(count);

    // now guaranteed to have enough
    this._bitsInBuffer -= count;

    let lower = (this._bitBuffer >>> this._bitsInBuffer) & this._maskFor(count);
    if (count === 32) {
      return lower >>> 0;
    }

    return ((res << count) | lower) >>> 0;
  }

  skipBits(count) {
    if (count === 0) return true;

    if (this._availableBits() < count) {
      this._insufficientBufferError("skip", count);
      return false;
    }

    // Fast path: consume from buffer
    if (this._bitsInBuffer >= count) {
      this._bitsInBuffer -= count;
      return true;
    }

    // consume remaining buffer
    count -= this._bitsInBuffer;
    this._bitBuffer = 0;
    this._bitsInBuffer = 0;

    // jump whole bytes
    const skipBytes = Math.floor(count / 8);
    const remainingBits = count % 8;

    this._index += skipBytes;

    if (remainingBits > 0) {
      this._bitBuffer = this._bytes[this._index++];
      this._bitsInBuffer = 8 - remainingBits;
    }

    return true;
  }

  peekBits(count) {
    if (count === 0) return 0;
    if (count > 32) {
      console.error("peekBits reads up to 32 bits");
      return null;
    }

    if (this._availableBits() < count) {
      this._insufficientBufferError("peek", count);
      return null;
    }

    // snapshot
    const index = this._index;
    const bitBuffer = this._bitBuffer;
    const bitsInBuffer = this._bitsInBuffer;

    const val = this.readBits(count);

    // restore
    this._index = index;
    this._bitBuffer = bitBuffer;
    this._bitsInBuffer = bitsInBuffer;

    return val;
  }

  readUE() {
    let leadingZeroBits = 0;

    while (true) {
      const bit = this.readBits(1);
      if (bit === null) return null;

      if (bit === 1) break;

      leadingZeroBits++;
      if (leadingZeroBits > 32) {
        console.error("readUE failed");
        return null;
      }
    }

    const suffix = this.readBits(leadingZeroBits);
    if (suffix === null) return null;

    return (1 << leadingZeroBits) - 1 + suffix;
  }

  readSE() {
    const value = this.readUE();
    if (value === null) return null;

    return (value & 1)
      ? (value + 1) >> 1
      : -(value >> 1);
  }

  _reset() {
    this._index = 0;
    this._bitBuffer = 0;
    this._bitsInBuffer = 0;
  }

  _maskFor(count) {
    return count === 32 ? 0xffffffff : ((1 << count) - 1) >>> 0;
  }

  _availableBits() {
    return this._bitsInBuffer + (this._bytes.length - this._index) * 8;
  }

  _fillBuffer(count) {
    // keep buffer <= 32 bits
    while (
      this._bitsInBuffer < count &&
      this._bitsInBuffer <= 24 &&
      this._index < this._bytes.length
    ) {
      this._bitBuffer = (this._bitBuffer << 8) | this._bytes[this._index++];
      this._bitsInBuffer += 8;
    }
  }

  _insufficientBufferError(op, count) {
    console.error(
      `not enough data to ${op} ${count} bits. Only ${this._availableBits()} available.`
    );
  }
}

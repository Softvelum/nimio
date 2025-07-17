export class ByteReader {
  static readUint(buffer, offset, length) {
    if (length === 4) {
      // Read a 32-bit unsigned int (big-endian)
      return (
        ((buffer[offset] << 24) |
          (buffer[offset + 1] << 16) |
          (buffer[offset + 2] << 8) |
          buffer[offset + 3]) >>>
        0
      ); // Ensure unsigned 32-bit
    } else if (length === 8) {
      // Read a 64-bit unsigned int (big-endian)
      const high =
        ((buffer[offset] << 24) |
          (buffer[offset + 1] << 16) |
          (buffer[offset + 2] << 8) |
          buffer[offset + 3]) >>>
        0; // High part (32 bit)
      const low =
        ((buffer[offset + 4] << 24) |
          (buffer[offset + 5] << 16) |
          (buffer[offset + 6] << 8) |
          buffer[offset + 7]) >>>
        0; // Low part (32 bit)
      // Mask high part to fit within 53-bit safe integer range
      const maskedHigh = high & 0x001fffff;
      const U32POWER = 0x0100000000;
      // Combine high and low parts
      return maskedHigh * U32POWER + low;
    } else {
      console.error("Unsupported length!");
      return null;
    }
  }
}

export function parseFlacConfig(data) {
  let bytes = data instanceof Uint8Array
    ? data
    : new Uint8Array(data);

  // bytes = new Uint8Array([0x12, 0x00, 0x12, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x92, 0x5c, 0x0b,
  //     0xb8, 0x03, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  //     0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  // debugger;

  const length = data.byteLength;
  let offset = 0;

  const minBlockSize = (bytes[offset] << 8) | bytes[offset + 1];
  offset += 2;

  const maxBlockSize = (bytes[offset] << 8) | bytes[offset + 1];
  offset += 2;

  if (minBlockSize !== maxBlockSize) {
    console.error(`Min block size ${minBlockSize} isn't equal to max block size ${maxBlockSize}`);
  }

  let sampleCount = maxBlockSize;

  // skip minimum frame size (24) and maximum frame size (24)
  offset += 6;
  // sample rate (20)
  const sampleRate = (bytes[offset] << 12) | (bytes[offset + 1] << 4) | (bytes[offset + 2] >> 4);

  // channels - 1 (3)
  const numberOfChannels = ((bytes[offset + 2] & 0x0E) >> 1) + 1;

  // bits per sample - 1 (5)
  // const bitsPerSample = (((bytes[offset + 2] & 0x01) << 4) | (bytes[offset + 3] >> 4)) + 1;
  
  // sampleCount *= bitsPerSample / 8;
  // debugger;
  
  return {
    sampleCount,
    sampleRate,
    numberOfChannels,
  };
}

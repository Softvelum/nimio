export function parseFlacConfig(data) {
  const STREAMINFO_LENGTH = 34;

  if (!data || data.byteLength !== STREAMINFO_LENGTH) {
    throw new Error("Invalid FLAC STREAMINFO metadata");
  }

  let offset = 0;
  const readUint16 = () => {
    const value = (data[offset] << 8) | data[offset + 1];
    offset += 2;
    return value;
  };

  const minBlockSize = readUint16();
  const maxBlockSize = readUint16();

  if (minBlockSize !== maxBlockSize) {
    console.warn(
      `Min block size ${minBlockSize} !== max block size ${maxBlockSize}`,
    );
  }

  // skip frame sizes (6 bytes)
  offset += 6;

  // sample rate (20 bits)
  const sampleRate =
    (data[offset] << 12) | (data[offset + 1] << 4) | (data[offset + 2] >> 4);

  // channels - 1 (3 bits)
  const numberOfChannels = ((data[offset + 2] & 0b00001110) >> 1) + 1;

  // bits per sample - 1 (5 bits)
  // const bitsPerSample =
  //   (((data[offset + 2] & 0x01) << 4) |
  //     (data[offset + 3] >> 4)) + 1;

  const description = new Uint8Array(data.length + 8);
  // "fLaC" + metadata block header (8 bytes)
  description.set([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22]);
  description.set(data, 8);

  return {
    sampleCount: maxBlockSize,
    sampleRate,
    numberOfChannels,
    description,
  };
}

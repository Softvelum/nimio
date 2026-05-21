export function parseFlacConfig(data) {
  const STREAMINFO_BLOCK_SIZE = 34;
  if (!data) throw new Error("No STREAMINFO metadata provided");

  let offset = 0;
  let isPureStreamInfoBlock = data.byteLength === STREAMINFO_BLOCK_SIZE;
  if (!isPureStreamInfoBlock) {
    if (
      !dataStartsWith4Bytes(data, "fLaC") ||
      data.byteLength < STREAMINFO_BLOCK_SIZE + 8
    ) {
      throw new Error("Invalid FLAC STREAMINFO metadata");
    }
    // full stream metadata received
    offset = 8;
  }

  const readUint16 = () => {
    const value = (data[offset] << 8) | data[offset + 1];
    offset += 2;
    return value;
  };

  const minBlockSize = readUint16();
  const maxBlockSize = readUint16();

  if (minBlockSize !== maxBlockSize) {
    console.log(
      `FLAC min block size ${minBlockSize} !== max block size ${maxBlockSize}`,
    );
  }

  // skip frame sizes (6 bytes)
  offset += 6;

  // sample rate (20 bits)
  const sampleRate =
    (data[offset] << 12) | (data[offset + 1] << 4) | (data[offset + 2] >> 4);
  if (maxBlockSize === 0) {
    // If the sample rate is <= 48 kHz, the strict subset maximum is 4608 samples
    if (sampleRate <= 48000) {
      maxBlockSize = 4608;
    } else {
      // The maximum possible block size in the FLAC format specification is 65,535 samples
      // per subframe. However, for "Streamable Subset" compatibility—which is required for
      // most streaming and hardware playback—the maximum block size is limited to 16,384 samples
      maxBlockSize = 16384;
    }
  }

  // channels - 1 (3 bits)
  const numberOfChannels = ((data[offset + 2] & 0b00001110) >> 1) + 1;

  let description;
  if (isPureStreamInfoBlock) {
    description = new Uint8Array(data.byteLength + 8);
    // "fLaC" + metadata block header (8 bytes)
    description.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0x00, 0x00, 0x22]);
    description.set(data, 8);
  } else {
    description = data;
  }

  return {
    sampleCount: maxBlockSize,
    sampleRate,
    numberOfChannels,
    description,
  };
}

function dataStartsWith4Bytes(arr, str) {
  if (arr.byteLength < 4 || str.length !== 4) return false;

  const view = new DataView(arr.buffer, arr.byteOffset, 4);
  const expected =
    (str.charCodeAt(0) << 24) |
    (str.charCodeAt(1) << 16) |
    (str.charCodeAt(2) << 8) |
    str.charCodeAt(3);

  return view.getUint32(0) === expected >>> 0;
}

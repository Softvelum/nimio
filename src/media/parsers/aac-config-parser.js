export function parseAACConfig(codecData) {
  const data = new Uint8Array(codecData);
  if (data.length < 2) {
    throw new Error("ASC parsing error. codecData too small");
  }

  const firstByte = data[0]; // 0x11
  const secondByte = data[1]; // 0x90

  // Audio Object Type (5 bits)
  const audioObjectType = firstByte >> 3;

  // Sampling Frequency Index (4 bits)
  const samplingFrequencyIndex = ((firstByte & 0x07) << 1) | (secondByte >> 7);

  // Channel Configuration (4 bits)
  const channelConfiguration = (secondByte >> 3) & 0x0f;

  // Frequency table
  const sampleRateTable = [
    96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025,
    8000, 7350,
  ];

  if (samplingFrequencyIndex >= sampleRateTable.length) {
    throw new Error(
      `samplingFrequencyIndex out of range: ${samplingFrequencyIndex}`,
    );
  }

  const sampleRate = sampleRateTable[samplingFrequencyIndex];
  const numberOfChannels = channelConfiguration;

  return {
    audioObjectType,
    sampleRate,
    numberOfChannels,
  };
}

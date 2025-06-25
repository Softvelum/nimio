export function parseAACConfig(codecData) {
  const data = new Uint8Array(codecData);
  if (data.length < 2) {
    throw new Error("ASC parsing error. codecData too small");
  }

  let samplingFrequencies = [
    96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025,
    8000, 7350,
  ];
  let samplesPerFrames = [1024, 960];

  let objectType = data[0] >> 3;
  let freqIndex = 0;
  if (31 === objectType) {
    freqIndex = (data[1] >> 1) & 0x0F;
  } else {
    freqIndex = ((data[0] & 0x07) << 1) | (data[1] >> 7);
  }

  let config = { audioObjectType: objectType };
  if (15 === freqIndex) {
    if (31 === objectType) {
      config.sampleRate =
        ((((data[1] & 0x01) << 7) | (data[2] >> 1)) << 16) |
        ((((data[2] & 0x01) << 7) | (data[3] >> 1)) << 8) |
        (((data[3] & 0x01) << 7) | (data[4] >> 1));
      config.numberOfChannels = ((data[4] & 0x01) << 3) | (data[5] >> 5);
      config.sampleCount = samplesPerFrames[(data[5] & 0x10) >> 4];
    } else {
      config.sampleRate =
        ((((data[1] & 0x7f) << 1) | (data[2] >> 7)) << 16) |
        ((((data[2] & 0x7f) << 1) | (data[3] >> 7)) << 8) |
        (((data[3] & 0x7f) << 1) | (data[4] >> 7));
      config.numberOfChannels = (data[4] & 0x78) >> 3;
      config.sampleCount = samplesPerFrames[(data[4] & 0x04) >> 2];
    }
  } else {
    config.sampleRate = samplingFrequencies[freqIndex];
    if (31 === objectType) {
      config.numberOfChannels = ((data[1] & 0x01) << 3) | (data[2] >> 5);
      config.sampleCount = samplesPerFrames[(data[2] & 0x10) >> 4];
    } else {
      config.numberOfChannels = (data[1] & 0x78) >> 3;
      config.sampleCount = samplesPerFrames[(data[1] & 0x04) >> 2];
    }
  }

  return config;
}

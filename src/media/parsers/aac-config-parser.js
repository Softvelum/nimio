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
    freqIndex = (data[1] >> 1) & 0x0f;
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
  
  if (config.numberOfChannels === 7) {
    config.numberOfChannels = 8; // 7.1 surround sound system
  }

  // TODO: When the channel configuration in an ASC header is 0,
  // it means the actual channel layout is not explicitly given in the ASC header.
  // Instead, it must be parsed from the program configuration element (PCE) inside the AAC raw data.
  // Currently Nimble Streamer doesn't provide the PCE. So, we skip this case for now (it's rather rare in fact).
  // A sample code for getting the channel layout from PCE is the following (not really tested):
  // function parseChannelsFromPCE(pceData) {
  //   const elementInstanceTag = readBits(4);
  //   const objectType = readBits(2);
  //   const samplingFreqIndex = readBits(4);
  //   const numFrontChannelElements = readBits(4);
  //   const numSideChannelElements = readBits(4);
  //   const numBackChannelElements = readBits(4);
  //   const numLfeChannelElements = readBits(2);
  //   const numAssocDataElements = readBits(3);
  //   const numValidCcElements = readBits(4);
  //   const monoMixdownPresent = readBits(1);
  //   if (monoMixdownPresent) readBits(4);
  //   const stereoMixdownPresent = readBits(1);
  //   if (stereoMixdownPresent) readBits(4);
  //   const matrixMixdownIdxPresent = readBits(1);
  //   if (matrixMixdownIdxPresent) readBits(3);
  //
  //   let channels = 0;
  //   // Each channel element flag indicates SCE/CPE type
  //   for (let i = 0; i < numFrontChannelElements; i++) {
  //     const isCpe = readBits(1);
  //     readBits(4); // element_tag_select
  //     channels += isCpe ? 2 : 1;
  //   }
  //   for (let i = 0; i < numSideChannelElements; i++) {
  //     const isCpe = readBits(1);
  //     readBits(4);
  //     channels += isCpe ? 2 : 1;
  //   }
  //   for (let i = 0; i < numBackChannelElements; i++) {
  //     const isCpe = readBits(1);
  //     readBits(4);
  //     channels += isCpe ? 2 : 1;
  //   }
  //   channels += numLfeChannelElements;
  //   return channels || null;
  // }

  return config;
}

export function parseMp3Config(codecData) {
  let MPEG_SAMPLES_PER_FRAME = [
    //#INVALID   L3     L2     L1
    [0, 576, 1152, 384], // MPEG 2.5
    [0, 0, 0, 0], // INVALID
    [0, 576, 1152, 384], // MPEG 2
    [0, 1152, 1152, 384], // MPEG 1
  ];

  let MPEG_SAMPLING_RATES = [
    //MPEG2.5  #INVALID  MPEG 2  MPEG 1
    [11025, 0, 22050, 44100], // 00
    [12000, 0, 24000, 48000], // 01
    [8000, 0, 16000, 32000], // 10
    [0, 0, 0, 0], // 11
  ];

  let MPEG_BIT_RATE = [
    [
      //#INVALID   L3     L2     L1
      [0, 0, 0, 0], // MPEG 2.5
      [0, 0, 0, 0], // INVALID
      [0, 0, 0, 0], // MPEG 2
      [0, 0, 0, 0], // MPEG 1
    ], // 0000
    [
      //#INVALID   L3     L2     L1
      [0, 8192, 8192, 32768], // MPEG 2.5
      [0, 0, 0, 0], // INVALID
      [0, 8192, 8192, 32768], // MPEG 2
      [0, 32768, 32768, 32768], // MPEG 1
    ], // 0001
    [
      //#INVALID   L3     L2     L1
      [0, 16384, 16384, 49152], // MPEG 2.5
      [0, 0, 0, 0], // INVALID
      [0, 16384, 16384, 49152], // MPEG 2
      [0, 40960, 49152, 65536], // MPEG 1
    ], // 0010
    [
      //#INVALID   L3     L2     L1
      [0, 24576, 24576, 57344], // MPEG 2.5
      [0, 0, 0, 0], // INVALID
      [0, 24576, 24576, 57344], // MPEG 2
      [0, 49152, 57344, 98304], // MPEG 1
    ], // 0011
    [
      //#INVALID   L3     L2     L1
      [0, 32768, 32768, 65536], // MPEG 2.5
      [0, 0, 0, 0], // INVALID
      [0, 32768, 32768, 65536], // MPEG 2
      [0, 57344, 65536, 131072], // MPEG 1
    ], // 0100
    [
      //#INVALID   L3     L2     L1
      [0, 40960, 40960, 81920], // MPEG 2.5
      [0, 0, 0, 0], // INVALID
      [0, 40960, 40960, 81920], // MPEG 2
      [0, 65536, 81920, 163840], // MPEG 1
    ], // 0101
    [
      //#INVALID   L3     L2     L1
      [0, 49152, 49152, 98304], // MPEG 2.5
      [0, 0, 0, 0], // INVALID
      [0, 49152, 49152, 98304], // MPEG 2
      [0, 81920, 98304, 196608], // MPEG 1
    ], // 0110
    [
      //#INVALID   L3     L2     L1
      [0, 57344, 57344, 114688], // MPEG 2.5
      [0, 0, 0, 0], // INVALID
      [0, 57344, 57344, 114688], // MPEG 2
      [0, 98304, 114688, 229376], // MPEG 1
    ], // 0111
    [
      //#INVALID   L3     L2     L1
      [0, 65536, 65536, 131072], // MPEG 2.5
      [0, 0, 0, 0], // INVALID
      [0, 65536, 65536, 131072], // MPEG 2
      [0, 114688, 131072, 262144], // MPEG 1
    ], // 1000
    [
      //#INVALID   L3     L2     L1
      [0, 81920, 81920, 147456], // MPEG 2.5
      [0, 0, 0, 0], // INVALID
      [0, 81920, 81920, 147456], // MPEG 2
      [0, 131072, 163840, 294912], // MPEG 1
    ], // 1001
    [
      //#INVALID   L3     L2     L1
      [0, 98304, 98304, 163840], // MPEG 2.5
      [0, 0, 0, 0], // INVALID
      [0, 98304, 98304, 163840], // MPEG 2
      [0, 163840, 196608, 327680], // MPEG 1
    ], // 1010
    [
      //#INVALID   L3     L2     L1
      [0, 114688, 114688, 180224], // MPEG 2.5
      [0, 0, 0, 0], // INVALID
      [0, 114688, 114688, 180224], // MPEG 2
      [0, 196608, 229376, 360448], // MPEG 1
    ], // 1011
    [
      //#INVALID   L3     L2     L1
      [0, 131072, 131072, 196608], // MPEG 2.5
      [0, 0, 0, 0], // INVALID
      [0, 131072, 131072, 196608], // MPEG 2
      [0, 229376, 262144, 393216], // MPEG 1
    ], // 1100
    [
      //#INVALID   L3     L2     L1
      [0, 147456, 147456, 229376], // MPEG 2.5
      [0, 0, 0, 0], // INVALID
      [0, 147456, 147456, 229376], // MPEG 2
      [0, 262144, 327680, 425984], // MPEG 1
    ], // 1101
    [
      //#INVALID   L3     L2     L1
      [0, 163840, 163840, 262144], // MPEG 2.5
      [0, 0, 0, 0], // INVALID
      [0, 163840, 163840, 262144], // MPEG 2
      [0, 327680, 393216, 458752], // MPEG 1
    ], // 1110
    [
      //#INVALID   L3     L2     L1
      [0, 0, 0, 0], // MPEG 2.5
      [0, 0, 0, 0], // INVALID
      [0, 0, 0, 0], // MPEG 2
      [0, 0, 0, 0], // MPEG 1
    ], // 1111
  ];

  let config = {};
  if ((codecData[0] & 0xff) == 0xff && (codecData[1] & 0xe0) == 0xe0) {
    let mpegVersionIndex = (codecData[1] >> 3) & 0x03;
    if (mpegVersionIndex == 1) {
      mpegVersionIndex = 0; // reserved is MPEG 2.5
    }
    let layerIndex = (codecData[1] >> 1) & 0x03;
    if (layerIndex != 0) {
      config.sampleCount = MPEG_SAMPLES_PER_FRAME[mpegVersionIndex][layerIndex];
      let bitrateIndex = (codecData[2] >> 4) & 0x0f;
      config.bitrate =
        MPEG_BIT_RATE[bitrateIndex][mpegVersionIndex][layerIndex];
      let sampleRateIndex = (codecData[2] >> 2) & 0x03;
      config.sampleRate =
        MPEG_SAMPLING_RATES[sampleRateIndex][mpegVersionIndex];
      let audioChannelMode = (codecData[3] >> 6) & 0x03;
      config.numberOfChannels = 3 == audioChannelMode ? 1 : 2;
    }
  }

  return config;
}

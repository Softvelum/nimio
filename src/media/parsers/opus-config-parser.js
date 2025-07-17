export function parseOpusConfig(opusPacket) {
  // The structure of the Opus frame header:
  // 1. TOC byte — always present (1 byte)
  // 2. Frame count byte — if frame count code (last 2 bits of TOC) is 3,
  //    this byte specifies the number of frames (1 byte)
  // 3. Optional padding length byte(s) — if padding is enabled
  //    (signaled in the frame count byte), one or more bytes may follow
  //    to indicate total padding size.

  // TOC Byte Structure (8 bits):
  // +-+-+-+-+-+-+-+-+
  // |  M | B | C | F |
  // +-+-+-+-+-+-+-+-+
  // Bits:
  // M = Mode (2 bits)
  // B = Bandwidth (3 bits)
  // C = Channel config (1 bit)
  // F = Frame count & padding info (2 bits)
  const toc = opusPacket[0];
  const config = toc & 0x1f;
  const frameCountCode = (toc >> 6) & 0x03;

  const getSamplesPerFrame = (cfg) => {
    if (cfg < 12) return 480; // SILK NB/MB
    if (cfg < 16) return 960; // SILK WB
    if (cfg < 20) return 1920; // Hybrid
    if (cfg < 24) return 2880; // CELT-only, 60 ms
    const mode = cfg & 3;
    return [120, 240, 480, 960][mode]; // CELT-only
  };

  const samplesPerFrame = getSamplesPerFrame(config);
  // Determine number of frames in the packet
  let numFrames = 1;
  if (frameCountCode === 1 || frameCountCode === 2) {
    numFrames = 2;
  } else if (frameCountCode === 3) {
    numFrames = opusPacket[1] & 0x3f;
  }

  return {
    sampleRate: 48000,
    numberOfChannels: 2, // Nimble streamer supports only 2 channels
    sampleCount: samplesPerFrame * numFrames,
  };
}

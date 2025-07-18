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
  // | config | s | c |
  // +-+-+-+-+-+-+-+-+
  // Bits:
  // config (5 bits)
  // s = Mono/Stereo (1 bit)
  // c = Frame count per packet (2 bits)
  const toc = opusPacket[0];
  const config = toc >> 3; // bits 3–7
  const frameCountCode = toc & 0x03; // bits 0–1

  const getSamplesPerFrame = (cfg) => {
    let durationMs = 0;
    if (cfg >= 0 && cfg <= 11) {
      // SILK: 10, 20, 40, 60 ms
      durationMs = 10 * (1 << cfg % 4);
    } else if (cfg >= 12 && cfg <= 15) {
      // Hybrid: only 10 or 20 ms
      durationMs = cfg % 2 === 0 ? 10 : 20;
    } else if (cfg >= 16 && cfg <= 31) {
      // CELT: 2.5, 5, 10, 20 ms
      durationMs = 2.5 * (1 << cfg % 4);
    }
    return durationMs * 48; // OPUS has constant sample rate 48Khz
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

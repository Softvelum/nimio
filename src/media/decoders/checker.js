export function adjustCodecId(codec) {
  if ("mp4a.40.34" == codec || "mp4a.69" == codec || "mp4a.6B" == codec) {
    return "mp3"; // AudioDecoder doesn't recognize the above codec ids as mp3
  }
  return codec;
}

export async function isCodecSupported(type, codec) {
  const decoder = type === "video" ? VideoDecoder : AudioDecoder;
  let result = false;
  try {
    const codecParams = makeCodecParams(type, codec);
    const support = await decoder.isConfigSupported(codecParams);
    result = support.supported;
  } catch (error) {}

  return result;
}

export async function checkSupportedCodecs(type, codecs) {
  const support = {};
  const decoder = type === "video" ? VideoDecoder : AudioDecoder;
  const checks = codecs.map((codec) => {
    const codecParams = makeCodecParams(type, codec);
    return decoder
      .isConfigSupported(codecParams)
      .then((result) => {
        support[codec] = result.supported;
      })
      .catch((error) => {
        support[codec] = false;
      });
  });
  await Promise.all(checks);

  return support;
}

function defaultFlacDescription() {
  // A minimal FLAC STREAMINFO metadata block (42 bytes) with default values
  // prettier-ignore
  const fd = new Uint8Array([
    0x66, 0x4c, 0x61, 0x43, // fLaC
    0x00, 0x00, 0x00, 0x22, // metadata block header (34 bytes length)
    0x12, 0x00, // min block size (4608 samples)
    0x12, 0x00, // max block size (4608 samples)
    0x00, 0x00, 0x00, // min frame size (0 - unknown)
    0x00, 0x00, 0x00, // max frame size (0 - unknown)
    0x0b, 0xb8, 0x03, 0xf0, // sample rate (48000 Hz), channels (2), bits per sample (32)
    // rest of the STREAMINFO can be zeros
    ...new Uint8Array(34 - 14),
  ]);
  return fd;
}

function makeCodecParams(type, codec) {
  const params = { codec: adjustCodecId(codec) };
  if (type === "audio") {
    // AudioDecoder requires sample rate and channel count to be specified
    // for the isConfigSupported check
    params.sampleRate = 48000; // Default sample rate
    params.numberOfChannels = 2; // Default number of channels
    if (codec === "flac") {
      params.description = defaultFlacDescription();
    }
  }

  return params;
}

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

function makeCodecParams(type, codec) {
  const params = { codec: adjustCodecId(codec) };
  if (type === "audio") {
    // AudioDecoder requires sample rate and channel count to be specified
    // for the isConfigSupported check
    params.sampleRate = 48000; // Default sample rate
    params.numberOfChannels = 2; // Default number of channels
  }

  return params;
}

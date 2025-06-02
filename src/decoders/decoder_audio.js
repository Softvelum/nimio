let audioDecoder;

let config = {};

function processDecodedFrame(audioFrame) {
  self.postMessage(
    {
      type: "audioFrame",
      audioFrame: audioFrame,
      decoderQueue: audioDecoder.decodeQueueSize,
    },
    [audioFrame],
  );
}

function handleDecoderError(error) {
  console.error("Audio Decoder error:", error);
  self.postMessage({ type: "decoderError", kind: 'audio' });
}

self.addEventListener("message", async function (e) {
  var type = e.data.type;

  if (type === "audioConfig") {
    config.codec = e.data.audioConfig.codec;
  } else if (type === "codecData") {
    audioDecoder = new AudioDecoder({
      output: (audioFrame) => {
        processDecodedFrame(audioFrame);
      },
      error: (e) => handleDecoderError(e.message),
    });

    Object.assign(config, e.data.aacConfig);
    try {
      audioDecoder.configure({
        codec: config.codec,
        sampleRate: config.sampleRate,
        numberOfChannels: config.numberOfChannels,
        description: e.data.codecData,
      });
    } catch (error) {
      handleDecoderError(error.message);
    }

  } else if (type === "audioChunk") {
    const frameWithHeader = new Uint8Array(e.data.frameWithHeader);
    const frame = frameWithHeader.subarray(
      e.data.framePos,
      frameWithHeader.byteLength,
    );

    const encodedAudioChunk = new EncodedAudioChunk({
      timestamp: e.data.timestamp,
      type: "key",
      data: frame,
    });

    audioDecoder.decode(encodedAudioChunk);
  }
});

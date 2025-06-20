import { RingBuffer } from "../../shared/ring-buffer.js";

let audioDecoder;
let timestampBuffer = new RingBuffer("Audio Decoder", 10_000);
let lastTimestampUs = undefined;
let frameDurationUs = undefined;

let config = {};

function processDecodedFrame(audioFrame) {
  let rawTimestamp = timestampBuffer.pop();
  let decTimestamp = audioFrame.timestamp;
  if (decTimestamp === rawTimestamp && lastTimestampUs !== undefined) {
    decTimestamp = lastTimestampUs + frameDurationUs;
  }
  lastTimestampUs = decTimestamp;

  self.postMessage(
    {
      type: "audioFrame",
      audioFrame: audioFrame,
      decoderQueue: audioDecoder.decodeQueueSize,
      rawTimestamp: rawTimestamp,
      decTimestamp: decTimestamp,
    },
    [audioFrame],
  );
}

function handleDecoderError(error) {
  console.error("Audio Decoder error:", error);
  self.postMessage({ type: "decoderError", kind: "audio" });
}

self.addEventListener("message", async function (e) {
  var type = e.data.type;

  if (type === "audioConfig") {
    config.codec = e.data.audioConfig.codec;
    timestampBuffer.reset();
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
      frameDurationUs = (1e6 * config.sampleCount) / config.sampleRate;
    } catch (error) {
      handleDecoderError(error.message);
    }
  } else if (type === "audioChunk") {
    const frameWithHeader = new Uint8Array(e.data.frameWithHeader);
    const frame = frameWithHeader.subarray(
      e.data.framePos,
      frameWithHeader.byteLength,
    );

    timestampBuffer.push(e.data.timestamp);
    const encodedAudioChunk = new EncodedAudioChunk({
      timestamp: e.data.timestamp,
      type: "key",
      data: frame,
    });

    audioDecoder.decode(encodedAudioChunk);
  }
});

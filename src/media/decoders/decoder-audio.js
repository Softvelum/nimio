import { RingBuffer } from "@/shared/ring-buffer.js";

let audioDecoder;
let lastTimestampUs;
let frameDurationUs;
let timestampBuffer = new RingBuffer("Audio Decoder", 3000);

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

function adjustCodec(codec) {
  if ("mp4a.40.34" == codec || "mp4a.69" == codec || "mp4a.6B" == codec) {
    return "mp3"; // AudioDecoder doesn't recognize the above codec ids as mp3
  }
  return codec;
}

self.addEventListener("message", async function (e) {
  var type = e.data.type;

  if (type === "config") {
    config.codec = adjustCodec(e.data.config.codec);
    timestampBuffer.reset();
  } else if (type === "codecData") {
    audioDecoder = new AudioDecoder({
      output: (audioFrame) => {
        processDecodedFrame(audioFrame);
      },
      error: (e) => handleDecoderError(e.message),
    });

    Object.assign(config, e.data.config);
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
  } else if (type === "chunk") {
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

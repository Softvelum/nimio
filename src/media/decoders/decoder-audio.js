import { SharedTransportBuffer } from "@/media/buffers/shared-transport-buffer";
import { RingBuffer } from "@/shared/ring-buffer.js";

let audioDecoder;
let lastTimestampUs;
let frameDurationUs;

let transBuffer;
let handleBuffer = new RingBuffer("Audio Decoder", 3000);

let config = {};

function processDecodedFrame(audioFrame) {
  let handle = handleBuffer.pop();
  let rawTimestamp = handle.ts;
  let decTimestamp = audioFrame.timestamp;
  if (decTimestamp === rawTimestamp && lastTimestampUs !== undefined) {
    decTimestamp = lastTimestampUs + frameDurationUs;
  }
  lastTimestampUs = decTimestamp;

  transBuffer.release(handle.handle);

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

async function pushNextFrame() {
  let counter = 0;
  while (true) {
    let frame = await transBuffer.readAsync();
    if (!frame) {
      setTimeout(async function () {
        await pushNextFrame();
      }, 10);
      return;
    }

    handleBuffer.push({ts: frame.ts, handle: frame.handle});
    const encodedAudioChunk = new EncodedAudioChunk({
      timestamp: frame.ts,
      type: "key",
      data: frame.frame,
    });
    audioDecoder.decode(encodedAudioChunk);
  }
}

self.addEventListener("message", async function (e) {
  var type = e.data.type;

  if (type === "config") {
    config.codec = e.data.config.codec;
    handleBuffer.reset();
    transBuffer = new SharedTransportBuffer(...e.data.buffer);
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
    await pushNextFrame();
  }
});

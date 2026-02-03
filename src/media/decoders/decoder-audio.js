import { RingBuffer } from "@/shared/ring-buffer";
import { adjustCodecId } from "./checker";

let audioDecoder;
let support;

let lastTimestampUs;
let frameDurationUs;
let timestampBuffer = new RingBuffer("Audio Decoder", 3000);

const buffered = [];
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
      type: "decodedFrame",
      audioFrame: audioFrame,
      decoderQueue: audioDecoder.decodeQueueSize,
      rawTimestamp: rawTimestamp,
      decTimestamp: decTimestamp,
    },
    [audioFrame],
  );
}

function pushChunk(data) {
  const encodedChunk = new EncodedAudioChunk(data);
  audioDecoder.decode(encodedChunk);
}

function shutdownDecoder() {
  try {
    if (typeof audioDecoder.close === "function") {
      audioDecoder.close();
    }
  } catch (e) {}
  audioDecoder = null;
}

function handleDecoderError(error) {
  console.error("Audio Decoder error:", error);
  self.postMessage({ type: "decoderError", kind: "audio" });
}

self.addEventListener("message", async function (e) {
  switch (e.data.type) {
    case "config":
      config.codec = adjustCodecId(e.data.config.codec);
      timestampBuffer.reset();
      buffered.length = 0;
      support = null;
      break;
    case "codecData":
      if (audioDecoder) support = null;
      audioDecoder = new AudioDecoder({
        output: (audioFrame) => {
          processDecodedFrame(audioFrame);
        },
        error: (e) => handleDecoderError(e.message),
      });

      Object.assign(config, e.data.config);
      let params = {
        codec: config.codec,
        sampleRate: config.sampleRate,
        numberOfChannels: config.numberOfChannels,
        description: e.data.codecData,
      };

      support = await AudioDecoder.isConfigSupported(params);
      if (support.supported) {
        try {
          audioDecoder.configure(params);
          frameDurationUs = (1e6 * config.sampleCount) / config.sampleRate;
        } catch (error) {
          handleDecoderError(error.message);
        }
      } else {
        handleDecoderError(`Audio codec not supported: ${config.codec}`);
      }
      break;
    case "chunk":
      const frameWithHeader = new Uint8Array(e.data.frameWithHeader);
      const frame = frameWithHeader.subarray(
        e.data.framePos,
        frameWithHeader.byteLength,
      );

      timestampBuffer.push(e.data.pts);
      const chunkData = {
        timestamp: e.data.pts,
        type: "key",
        data: frame,
      };

      if (!support || !support.supported) {
        // Buffer the chunk until the decoder is ready
        buffered.push(chunkData);
        return;
      }

      if (buffered.length > 0) {
        // Process buffered chunks before the new one
        for (let i = 0; i < buffered.length; i++) {
          pushChunk(buffered[i]);
        }
        buffered.length = 0;
      }

      pushChunk(chunkData);
      break;
    case "shutdown":
      if (audioDecoder) {
        buffered.length = 0;
        shutdownDecoder();
        self.postMessage({ type: "shutdownComplete" });
        self.close();
      }
      break;
    default:
      console.warn("DecoderAudio: unknown message type", e.data.type);
      break;
  }
});

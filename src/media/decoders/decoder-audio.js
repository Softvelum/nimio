import { RingBuffer } from "@/shared/ring-buffer";
import { adjustCodecId } from "./checker";
import { getFrameData } from "@/shared/data-helpers";

let audioDecoder;
let support;
let params;
let errorsCount = 0;

let lastTimestampUs = null;
let frameDurationUs = null;
let timestampBuffer = new RingBuffer("Audio Decoder", 3000);

const MAX_RECOVERY_ATTEMPTS = 30;
const buffered = [];
let config = {};

function createAudioDecoder() {
  return new AudioDecoder({
    output: (audioFrame) => {
      processDecodedFrame(audioFrame);
      errorsCount = 0;
    },
    error: (e) => tryRecoverDecoderError(e.message),
  });
}

function processDecodedFrame(audioFrame) {
  let rawTimestamp = timestampBuffer.pop();
  let decTimestamp = audioFrame.timestamp;
  if (decTimestamp === rawTimestamp && lastTimestampUs !== null) {
    decTimestamp = lastTimestampUs + frameDurationUs;
  }
  lastTimestampUs = decTimestamp;

  self.postMessage(
    {
      type: "decodedFrame",
      decoderQueue: audioDecoder.decodeQueueSize,
      audioFrame,
      rawTimestamp,
      decTimestamp,
    },
    [audioFrame],
  );
}

function pushChunk(data) {
  if (audioDecoder.state !== "configured") return false;

  const encodedChunk = new EncodedAudioChunk(data);
  audioDecoder.decode(encodedChunk);
  return true;
}

function tryRecoverDecoderError(error) {
  console.error(`Trying to recover from decoder error: ${error}`);
  if (!audioDecoder) return;

  errorsCount++;
  if (errorsCount > MAX_RECOVERY_ATTEMPTS) {
    return handleDecoderError(error);
  }

  if (lastTimestampUs !== null) {
    lastTimestampUs += frameDurationUs * timestampBuffer.length;
    timestampBuffer.reset();
  }
  console.log(`Recover: audio decoder state is ${audioDecoder.state}`);
  if (audioDecoder.state !== "closed") {
    audioDecoder.reset();
    return;
  }

  audioDecoder = createAudioDecoder();
  // configure decoder with the same config
  audioDecoder.configure(params);
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
      errorsCount = 0;
      break;
    case "codecData":
      if (audioDecoder) {
        support = null;
        errorsCount = 0;
        await audioDecoder.flush();
        shutdownDecoder();
        lastTimestampUs = null;
      }
      audioDecoder = createAudioDecoder();

      Object.assign(config, e.data.config);
      params = {
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
      if (errorsCount > MAX_RECOVERY_ATTEMPTS) {
        // Decoder failed to recover after multiple attempts,
        // ignore incoming chunks and wait for shutdown
        return;
      }

      timestampBuffer.push(e.data.pts);
      const chunkData = {
        timestamp: e.data.pts,
        type: "key",
        data: getFrameData(e.data),
      };

      if (!support || !support.supported) {
        // Buffer the chunk until the decoder is ready
        buffered.push(chunkData);
        return;
      }

      if (buffered.length > 0) {
        // Process buffered chunks before the new one
        let i = 0;
        for (; i < buffered.length; i++) {
          if (!pushChunk(buffered[i])) {
            break;
          }
        }
        if (i === buffered.length) {
          buffered.length = 0;
        } else {
          console.warn(
            `Stopped processing buffered chunks at ${i} due to decoder wasn't ready`,
          );
          if (i > 0) buffered.splice(0, i);
        }
      }

      let processed = pushChunk(chunkData);
      if (!processed) {
        console.warn(
          `Decoder not ready, buffering chunk with ts = ${chunkData.timestamp}`,
        );
        buffered.push(chunkData);
      }
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

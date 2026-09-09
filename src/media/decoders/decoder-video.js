import { getFrameData } from "@/shared/data-helpers";

let videoDecoder;
let support;
let params;
let waitingForKeyframe;
let errorsCount = 0;

let config = {};
const decodeTimings = new Map();
const buffered = [];
const MAX_RECOVERY_ATTEMPTS = 10;

function createVideoDecoder() {
  return new VideoDecoder({
    output: (frame) => {
      processDecodedFrame(frame);
      errorsCount = 0;
    },
    error: async (e) => {
      await tryRecoverDecoderError(e.message);
    },
  });
}

function processDecodedFrame(videoFrame) {
  const t0 = decodeTimings.get(videoFrame.timestamp);
  let latencyMs = 0;
  if (t0 != null) {
    latencyMs = performance.now() - t0;
    decodeTimings.delete(videoFrame.timestamp);
  }

  if (latencyMs > 600) {
    console.warn(
      `Video frame latency is too high: ${latencyMs} ms for timestamp ${videoFrame.timestamp}`,
    );
  }

  self.postMessage(
    {
      type: "decodedFrame",
      decoderQueue: videoDecoder.decodeQueueSize,
      decoderLatency: latencyMs,
      videoFrame,
    },
    [videoFrame],
  );
}

function handleDecoderError(error) {
  console.error("Video Decoder error:", error);
  self.postMessage({ type: "decoderError", kind: "video" });
}

function pushChunk(data, time) {
  if (videoDecoder.state !== "configured") return false;
  if (waitingForKeyframe) {
    if (data.type !== "key") return true;
    waitingForKeyframe = false;
  }

  const encodedChunk = new EncodedVideoChunk(data);
  videoDecoder.decode(encodedChunk);
  decodeTimings.set(encodedChunk.timestamp, time);
  return true;
}

async function tryRecoverDecoderError(error) {
  console.error(`Trying to recover from decoder error: ${error}`);
  if (!videoDecoder) return;

  errorsCount++;
  if (errorsCount > MAX_RECOVERY_ATTEMPTS) {
    return handleDecoderError(error);
  }

  decodeTimings.clear();
  console.log(`Recover: video decoder state is ${videoDecoder.state}`);
  if (videoDecoder.state === "closed") {
    videoDecoder = createVideoDecoder();
  } else {
    videoDecoder.reset();
  }

  // configure decoder with the same config
  await configureDecoder();
  waitingForKeyframe = true;
}

async function configureDecoder() {
  const preferences = ["prefer-hardware", "prefer-software", "no-preference"];
  // On recovery, start with the mode that previously configured successfully.
  const startIndex = preferences.indexOf(params.hardwareAcceleration);
  let errorMessage = `Video codec not supported: ${params.codec}`;
  support = null;

  for (const hardwareAcceleration of preferences.slice(startIndex)) {
    const candidateParams = { ...params, hardwareAcceleration };
    try {
      const candidateSupport =
        await VideoDecoder.isConfigSupported(candidateParams);
      if (!candidateSupport.supported) {
        console.warn(
          `Video decoder not supported: codec=${params.codec}, accel=${hardwareAcceleration}`,
        );
        continue;
      }

      console.log(
        `configureDecoder codec=${params.codec}, accel=${hardwareAcceleration}`,
      );
      videoDecoder.configure(candidateParams);
      params = candidateParams;
      support = candidateSupport;
      return;
    } catch (error) {
      errorMessage = error.message;
      console.warn(
        `Video decoder configuration failed: codec=${params.codec}, accel=${hardwareAcceleration}: ${errorMessage}`,
      );
    }
  }

  handleDecoderError(errorMessage);
}

function shutdownDecoder() {
  try {
    if (typeof videoDecoder.close === "function") {
      videoDecoder.close();
    }
  } catch (e) {}
  videoDecoder = null;
}

self.addEventListener("message", async function (e) {
  switch (e.data.type) {
    case "config":
      config = e.data.config;
      buffered.length = 0;
      support = null;
      errorsCount = 0;
      break;
    case "codecData":
      if (videoDecoder) {
        support = null;
        errorsCount = 0;
        decodeTimings.clear();
        const vd = videoDecoder;
        videoDecoder.flush().finally(function () {
          if (typeof vd.close === "function") vd.close();
        });
      }
      videoDecoder = createVideoDecoder();

      params = {
        codec: config.codec,
        codedWidth: config.width,
        codedHeight: config.height,
        hardwareAcceleration: "prefer-software",
        // optimizeForLatency: true,
      };
      if (config.hardwareAcceleration) {
        params.hardwareAcceleration = "prefer-hardware";
      }
      if (e.data.codecData) {
        params.description = e.data.codecData;
      }

      await configureDecoder();
      break;
    case "chunk":
      if (errorsCount > MAX_RECOVERY_ATTEMPTS) {
        // Decoder failed to recover after multiple attempts,
        // ignore incoming chunks and wait for shutdown
        return;
      }

      const chunkData = {
        timestamp: e.data.pts,
        type: e.data.chunkType,
        data: getFrameData(e.data),
      };
      if (!support?.supported) {
        // Buffer the chunk until the decoder is ready
        buffered.push({
          time: performance.now(),
          chunk: chunkData,
        });
        return;
      }

      if (buffered.length > 0) {
        // Process buffered chunks before the new one
        let i = 0;
        for (; i < buffered.length; i++) {
          if (!pushChunk(buffered[i].chunk, buffered[i].time)) {
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

      let processed = pushChunk(chunkData, performance.now());
      if (!processed) {
        console.warn(
          `Decoder not ready, buffering chunk with ts = ${chunkData.timestamp}`,
        );
        buffered.push({
          time: performance.now(),
          chunk: chunkData,
        });
      }
      break;
    case "shutdown":
      if (videoDecoder) {
        buffered.length = 0;
        decodeTimings.clear();
        shutdownDecoder();
        self.postMessage({ type: "shutdownComplete" });
        self.close();
      }
      break;
    default:
      console.warn("DecoderVideo: unknown message type", e.data.type);
      break;
  }
});

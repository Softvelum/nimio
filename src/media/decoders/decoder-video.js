import { getFrameData } from "@/shared/data-helpers";

let videoDecoder;
let support;
let params;
let waitingForKeyframe;

let config = {};
const decodeTimings = new Map();
const buffered = [];

function createVideoDecoder() {
  return new VideoDecoder({
    output: (frame) => {
      processDecodedFrame(frame);
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
  if (videoDecoder) {
    decodeTimings.clear();
    console.log(`video decoder state is ${videoDecoder.state}`);
    if (videoDecoder.state !== "closed") {
      videoDecoder.reset();
      return;
    }

    videoDecoder = createVideoDecoder();
    // configure decoder with the same config
    await configureDecoder();
    waitingForKeyframe = true;
  }
}

async function fallbackToSoftwareSupport() {
  console.warn(
    "Hardware acceleration not supported, falling back to software decoding",
  );
  params.hardwareAcceleration = "prefer-software";
  support = await VideoDecoder.isConfigSupported(params);
}

async function configureDecoder() {
  if (!support.supported) {
    return handleDecoderError(`Video codec not supported: ${params.codec}`);
  }

  console.log(
    `configureDecoder codec=${params.codec}, accel=${params.hardwareAcceleration}`,
  );

  try {
    videoDecoder.configure(params);
  } catch (error) {
    support.supported = false;
    console.warn("configureDecoder exception raised");
    if (params.hardwareAcceleration === "prefer-hardware") {
      // last ditch attempt
      await fallbackToSoftwareSupport();
      return await configureDecoder();
    }
    handleDecoderError(error.message);
  }
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
      break;
    case "codecData":
      if (videoDecoder) {
        support = null;
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

      support = await VideoDecoder.isConfigSupported(params);
      if (!support.supported) await fallbackToSoftwareSupport();
      await configureDecoder();
      break;
    case "chunk":
      const chunkData = {
        timestamp: e.data.pts,
        type: e.data.chunkType,
        data: getFrameData(e.data),
      };
      if (!support || !support.supported) {
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
          // console.warn(
          //   `Processing buffered chunk with ts = ${buffered[i].chunk.timestamp}, key = ${buffered[i].chunk.type === "key"}`,
          // );
          if (!pushChunk(buffered[i].chunk, buffered[i].time)) {
            break;
          }
        }
        if (i === buffered.length) {
          // console.warn(
          //   `Processed all buffered chunks, total ${i} chunks, decoder is ready now`,
          // );
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

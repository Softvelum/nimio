let videoDecoder;
let support;

let config = {};
const decodeTimings = new Map();
const buffered = [];

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
      videoFrame: videoFrame,
      decoderQueue: videoDecoder.decodeQueueSize,
      decoderLatency: latencyMs,
    },
    [videoFrame],
  );
}

function handleDecoderError(error) {
  console.error("Video Decoder error:", error);
  self.postMessage({ type: "decoderError", kind: "video" });
}

function pushChunk(data, ts) {
  const encodedChunk = new EncodedVideoChunk(data);
  videoDecoder.decode(encodedChunk);
  decodeTimings.set(encodedChunk.timestamp, ts);
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
  var type = e.data.type;
  switch (e.data.type) {
    case "config":
      config = e.data.config;
      buffered.length = 0;
      support = null;
      break;
    case "codecData":
      videoDecoder = new VideoDecoder({
        output: (frame) => {
          processDecodedFrame(frame);
        },
        error: (e) => handleDecoderError(e.message),
      });
  
      let params = {
        codec: config.codec,
        codedWidth: config.width,
        codedHeight: config.height,
        // optimizeForLatency: true,
        hardwareAcceleration: "prefer-hardware",
      };
      if (e.data.codecData) {
        params.description = e.data.codecData;
      }
  
      support = await VideoDecoder.isConfigSupported(params);
      if (!support.supported) {
        console.warn(
          "Hardware acceleration not supported, falling back to software decoding",
        );
        params.hardwareAcceleration = "prefer-software";
        support = await VideoDecoder.isConfigSupported(params);
      }
  
      if (support.supported) {
        try {
          videoDecoder.configure(params);
        } catch (error) {
          handleDecoderError(error.message);
        }
      } else {
        // handle unsupported codec
        handleDecoderError(`Video codec not supported: ${config.codec}`);
      }
      break;
    case "chunk":
      const frameWithHeader = new Uint8Array(e.data.frameWithHeader);
      const frame = frameWithHeader.subarray(
        e.data.framePos,
        frameWithHeader.byteLength,
      );
  
      const chunkData = {
        timestamp: e.data.timestamp,
        type: e.data.chunkType,
        data: frame,
      };
      if (!support || !support.supported) {
        // Buffer the chunk until the decoder is ready
        buffered.push({
          ts: performance.now(),
          chunk: chunkData,
        });
        return;
      }
  
      if (buffered.length > 0) {
        // Process buffered chunks before the new one
        for (let i = 0; i < buffered.length; i++) {
          pushChunk(buffered[i].chunk, buffered[i].ts);
        }
        buffered.length = 0;
      }
  
      pushChunk(chunkData, performance.now());
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
      console.warn("DecoderVideo: unknown message type", type);
      break;
  }
});

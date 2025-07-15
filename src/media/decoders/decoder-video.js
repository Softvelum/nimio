import { SharedTransportBuffer } from "@/media/buffers/shared-transport-buffer";
import { RingBuffer } from "@/shared/ring-buffer.js";

let videoDecoder;
let support;

let config = {};
const decodeTimings = new Map();
const buffered = [];
let transBuffer;
let handleBuffer = new RingBuffer("Video Decoder", 1000);

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
  let handle = handleBuffer.pop();
  transBuffer.release(handle);

  self.postMessage(
    {
      type: "videoFrame",
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

async function pushNextFrame() {
  while (true) {
    let frame = await transBuffer.readAsync();
    if (!frame) {
      setTimeout(async function () {
        await pushNextFrame();
      }, 10);
      return;
    }
    const chunkData = {
      timestamp: frame.ts,
      type: frame.type === 1 ? "key" : "delta",
      data: frame.frame,
    };
    handleBuffer.push(frame.handle);

    pushChunk(chunkData, performance.now());
  }
}

self.addEventListener("message", async function (e) {
  var type = e.data.type;

  if (type === "config") {
    config = e.data.config;
    buffered.length = 0;
    support = null;
    handleBuffer.reset();
    transBuffer = new SharedTransportBuffer(...e.data.buffer);
  } else if (type === "codecData") {
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
      description: e.data.codecData,
    };

    support = await VideoDecoder.isConfigSupported(params);
    if (!support.supported) {
      console.warn(
        "Hardware acceleration not supported, falling back to software decoding",
      );
      params.hardwareAcceleration = "prefer-software";
      support = await VideoDecoder.isConfigSupported(params);
    }

    if (support.supported) {
      videoDecoder.configure(params);
      await pushNextFrame();
    } else {
      // handle unsupported codec
      handleDecoderError(`Video codec not supported: ${config.codec}`);
    }
  }
});

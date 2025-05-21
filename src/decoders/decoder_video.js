let videoDecoder = null;

let config = {};
const decodeTimings = new Map();

function processDecodedFrame(videoFrame) {
  const t0 = decodeTimings.get(videoFrame.timestamp);
  let latencyMs = 0;
  if (t0 != null) {
    latencyMs = performance.now() - t0;
    decodeTimings.delete(videoFrame.timestamp);
  }

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

self.addEventListener("message", async function (e) {
  var type = e.data.type;

  if (type === "videoConfig") {
    config = e.data.videoConfig;
  } else if (type === "codecData") {
    videoDecoder = new VideoDecoder({
      output: (frame) => {
        processDecodedFrame(frame);
      },
      error: (e) => console.error("Decoder error:", e),
    });

    let params = {
      codec: config.codec,
      codedWidth: config.width,
      codedHeight: config.height,
      // optimizeForLatency: true,
      hardwareAcceleration: "prefer-hardware",
      description: e.data.codecData,
    };

    let support = await VideoDecoder.isConfigSupported(params);
    if (!support.supported) {
      console.warn(
        "Hardware acceleration not supported, falling back to software decoding",
      );
      params.hardwareAcceleration = "prefer-software";
      support = await VideoDecoder.isConfigSupported(params);
    }
    if (support.supported) {
      videoDecoder.configure(params);
    } else {
      // TODO: handle unsupported codec
      console.error("Video codec not supported", config.codec);
      // self.postMessage({ type: "decoderError", message: "Video codec not supported" });
    }
  } else if (type === "videoChunk") {
    const frameWithHeader = new Uint8Array(e.data.frameWithHeader);
    const frame = frameWithHeader.subarray(
      e.data.framePos,
      frameWithHeader.byteLength,
    );

    const encodedVideoChunk = new EncodedVideoChunk({
      timestamp: e.data.timestamp,
      type: e.data.chunkType,
      data: frame,
    });

    videoDecoder.decode(encodedVideoChunk);
    decodeTimings.set(encodedVideoChunk.timestamp, performance.now());
  }
});

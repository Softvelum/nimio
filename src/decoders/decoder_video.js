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

  if (latencyMs > 1000) {
    console.warn(
      `Video frame latency is too high: ${latencyMs} ms for timestamp ${videoFrame.timestamp}`
    );
  }

  self.postMessage({
    type: "videoFrame",
    videoFrame: videoFrame,
    decoderQueue: videoDecoder.decodeQueueSize,
    decoderLatency: latencyMs
  }, [videoFrame]);
}

function pushChunk (data, ts) {
  const encodedChunk = new EncodedVideoChunk(data);
  videoDecoder.decode(encodedChunk);
  decodeTimings.set(encodedChunk.timestamp, ts || performance.now());
}

self.addEventListener('message', async function(e) {
  var type = e.data.type;

  if (type === "videoConfig") {
    config = e.data.videoConfig;
    buffered.length = 0;
    support = null;
  } else if (type === "codecData") {
    videoDecoder = new VideoDecoder({
      output: (frame) => {
        processDecodedFrame(frame);
      },
      error: (e) => console.error('Decoder error:', e)
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
        "Hardware acceleration not supported, falling back to software decoding"
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
    const frame = frameWithHeader.subarray(e.data.framePos, frameWithHeader.byteLength);

    const chunkData = {
      timestamp: e.data.timestamp,
      type: e.data.chunkType,
      data: frame,
    };
    if (!support || !support.supported) {
      // Buffer the chunk until the decoder is ready
      buffered.push({
        ts: this.performance.now(),
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
  }
});

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

    self.postMessage({
        type: "videoFrame",
        videoFrame: videoFrame,
        decoderQueue: videoDecoder.decodeQueueSize,
        decoderLatency: latencyMs
    }, [videoFrame]);
}

self.addEventListener('message', async function(e) {
    var type = e.data.type;

    if (type === "videoConfig") {
        config = e.data.videoConfig;
    } else if (type === "codecData") {
        videoDecoder = new VideoDecoder({
            output: frame => {
                processDecodedFrame(frame);
            },
            error: e => console.error('Decoder error:', e)
        });

        videoDecoder.configure({
            codec: config.codec,
            codedWidth: config.width,
            codedHeight: config.height,
            // optimizeForLatency: true,
            hardwareAcceleration: 'prefer-hardware',
            description: e.data.codecData
        });
    } else if (type === "videoChunk") {
        const frameWithHeader = new Uint8Array(e.data.frameWithHeader);
        const frame = frameWithHeader.subarray(e.data.framePos, frameWithHeader.byteLength);

        const encodedVideoChunk = new EncodedVideoChunk({
            timestamp: e.data.timestamp,
            type: e.data.chunkType,
            data: frame
        });

        videoDecoder.decode(encodedVideoChunk);
        decodeTimings.set(encodedVideoChunk.timestamp, performance.now());
    }
})

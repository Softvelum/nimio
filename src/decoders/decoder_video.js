let videoDecoder = null;

let config = {}

function processDecodedFrame(videoFrame) {
    self.postMessage({type: "videoFrame", videoFrame: videoFrame}, [videoFrame]);
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
            optimizeForLatency: true,
            hardwareAcceleration: 'prefer-hardware',
            // bitrate: 1_000_000, // 1 Mbps
            // framerate: 30,
            latencyMode: 'realtime', // one chunk = one frame
            description: e.data.codecData
        });
    } else if (type === "videoChunk") {
        videoDecoder.decode(e.data.videoChunk);
    }
})

let videoDecoder = null;

function processDecodedFrame(videoFrame) {
    self.postMessage({type: "videoFrame", videoFrame: videoFrame}, [videoFrame]);
}

self.addEventListener('message', async function(e) {
    var type = e.data.type;

    // console.log("decoder_video message received: ", type);

    if (type === "codecData") {
        videoDecoder = new VideoDecoder({
            output: frame => {
                processDecodedFrame(frame);
            },
            error: e => console.error('Decoder error:', e)
        });

        videoDecoder.configure({
            codec: 'avc1.4d4015', //TODO: use params from status
            codedWidth: 476,
            codedHeight: 268,
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

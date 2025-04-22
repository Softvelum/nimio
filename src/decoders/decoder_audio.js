let audioDecoder = null;

let config = {};

function processDecodedFrame(audioFrame) {
    self.postMessage({type: "audioFrame", audioFrame: audioFrame}, [audioFrame]);
}

self.addEventListener('message', async function(e) {
    var type = e.data.type;

    if (type === "audioConfig") {
        config.codec = e.data.audioConfig.codec;
    } else if (type === "codecData") {
        audioDecoder = new AudioDecoder({
            output: audioFrame => {
                processDecodedFrame(audioFrame);
            },
            error: e => console.error('Audio Decoder error:', e)
        })

        Object.assign(config, e.data.aacConfig);

        audioDecoder.configure({
            codec: config.codec,
            sampleRate: config.sampleRate,
            numberOfChannels: config.numberOfChannels,
            description: e.data.codecData
        });
    } else if (type === "audioChunk") {
        audioDecoder.decode(e.data.audioChunk);
    }
})

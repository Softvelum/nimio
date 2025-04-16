let audioDecoder = null;

function processDecodedFrame(audioFrame) {
    self.postMessage({type: "audioFrame", audioFrame: audioFrame}, [audioFrame]);
}

self.addEventListener('message', async function(e) {
    var type = e.data.type;

    console.log("decoder_audio message received: ", type);

    if (type === "codecData") {
        audioDecoder = new AudioDecoder({
            output: audioFrame => {
                processDecodedFrame(audioFrame);
                // audioFrame.close(); //TODO: find proper place to close frame
            },
            error: e => console.error('Audio Decoder error:', e)
        })

        audioDecoder.configure({
            codec: 'mp4a.40.2', //TODO: use params from status
            sampleRate: 48000,
            numberOfChannels: 2,
            description: e.data.codecData
        });
    } else if (type === "audioChunk") {
        audioDecoder.decode(e.data.audioChunk);
    }
})

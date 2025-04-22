let audioDecoder = null;

let config = {};

function parseAACConfig(codecData) { //TODO: move out from worker
    const data = new Uint8Array(codecData);
    if (data.length < 2) {
        throw new Error("ASC parsing error. codecData too small");
    }

    const firstByte = data[0]; // 0x11
    const secondByte = data[1]; // 0x90

    // Audio Object Type (5 bits)
    const audioObjectType = firstByte >> 3;

    // Sampling Frequency Index (4 bits)
    const samplingFrequencyIndex = ((firstByte & 0x07) << 1) | (secondByte >> 7);

    // Channel Configuration (4 bits)
    const channelConfiguration = (secondByte >> 3) & 0x0F;

    // Frequency table
    const sampleRateTable = [
        96000, 88200, 64000, 48000, 44100, 32000,
        24000, 22050, 16000, 12000, 11025, 8000, 7350
    ];

    if (samplingFrequencyIndex >= sampleRateTable.length) {
        throw new Error(`samplingFrequencyIndex out of range: ${samplingFrequencyIndex}`);
    }

    const sampleRate = sampleRateTable[samplingFrequencyIndex];
    const numberOfChannels = channelConfiguration;

    return {
        audioObjectType,
        sampleRate,
        numberOfChannels
    };
}

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

        const aac_config = parseAACConfig(e.data.codecData);
        Object.assign(config, aac_config);

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

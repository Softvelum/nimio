const WEB_AAC_SEQUENCE_HEADER =   0
const WEB_AAC_FRAME =             1
const WEB_AVC_SEQUENCE_HEADER =   2
const WEB_AVC_KEY_FRAME =         3
const WEB_AVC_FRAME =             4
const WEB_HEVC_SEQUENCE_HEADER =  5
const WEB_HEVC_KEY_FRAME =        6
const WEB_HEVC_FRAME =            7
const WEB_VP6_KEY_FRAME=          8
const WEB_VP6_FRAME =             9
const WEB_VP8_KEY_FRAME =        10
const WEB_VP8_FRAME =            11
const WEB_VP9_KEY_FRAME =        12
const WEB_VP9_FRAME =            13
const WEB_MP3 =                  14
const WEB_OPUS_FRAME =           15
const WEB_AV1_SEQUENCE_HEADER =  16
const WEB_AV1_KEY_FRAME =        17
const WEB_AV1_FRAME =            18

let socket = null;

function logbin(bin) {
    console.log([...bin.slice(0, 32)].map(byte => byte.toString(16).padStart(2, '0')).join(' '));
}

function readInt(buffer, offset, length) {
    if (length === 4) {
        // Read a 32-bit unsigned int (big-endian)
        return (
            (buffer[offset] << 24) |
            (buffer[offset + 1] << 16) |
            (buffer[offset + 2] << 8) |
            buffer[offset + 3]
        ) >>> 0; // Ensure unsigned 32-bit
    } else if (length === 8) {
        // Read a 64-bit unsigned int (big-endian)
        const high = (
            (buffer[offset] << 24) |
            (buffer[offset + 1] << 16) |
            (buffer[offset + 2] << 8) |
            buffer[offset + 3]
        ) >>> 0; // High part (32 bit)
        const low = (
            (buffer[offset + 4] << 24) |
            (buffer[offset + 5] << 16) |
            (buffer[offset + 6] << 8) |
            buffer[offset + 7]
        ) >>> 0; // Low part (32 bit)
        // Mask high part to fit within 53-bit safe integer range
        const maskedHigh = high & 0x001FFFFF;
        // Combine high and low parts
        return (maskedHigh * 2**32) + low;
    } else {
        console.error('Unsupported length!');
        return null;
    }
}

function processFrame(event) {
    let frameWithHeader = new Uint8Array(event.data);
    let trackId = frameWithHeader[0];
    let frameType = frameWithHeader[1];
    let showTime = 0;
    let dataPos = 10;
    let frameSize = frameWithHeader.byteLength;
    let timestamp;

    // console.debug('Frame received:', frameType);

    if (frameType === WEB_AAC_SEQUENCE_HEADER || frameType === WEB_AVC_SEQUENCE_HEADER) {
        let codecData = frameWithHeader.subarray(2, frameSize);
        if (frameType === WEB_AAC_SEQUENCE_HEADER) {
            // console.log('audio codecData received');
            self.postMessage({type: "audioCodecData", codecData: codecData});
        } else if (frameType === WEB_AVC_SEQUENCE_HEADER) {
            // console.log('video codecData received');
            self.postMessage({type: "videoCodecData", codecData: codecData});
        }
    } else if (frameType === WEB_AAC_FRAME) {
        timestamp = readInt(frameWithHeader, 2, 8);

        if (true) { //TODO: useSteady
            showTime = readInt(frameWithHeader, dataPos, 8);
            dataPos += 8;
        }
        let frame = frameWithHeader.subarray(dataPos, frameSize);
        // logbin(frame);
        let timestampSeconds = timestamp/90000; //todo timescale
        let timestampMicroseconds = 1000000 * timestampSeconds;
        const audioChunk = new EncodedAudioChunk({
            timestamp: timestampMicroseconds,
            type: 'key',
            // duration: 21333, //todo use correct duration?
            data: frame
        });
        // console.log('AUDIO inMicrosecondsTimestamp',inMicrosecondsTimestamp)
        self.postMessage({type: "audioChunk", audioChunk: audioChunk});
    } else if (frameType === WEB_AVC_KEY_FRAME || frameType === WEB_AVC_FRAME) {
        timestamp = readInt(frameWithHeader, 2, 8);
        if (true) {//TODO: useSteady
            showTime = readInt(frameWithHeader, dataPos, 8);
            dataPos += 8;
        }
        let compositionOffset = 0
        compositionOffset = readInt(frameWithHeader, dataPos, 4);
        dataPos += 4;
        let frame = frameWithHeader.subarray(dataPos, frameSize);

        const isKey = frameType === WEB_AVC_KEY_FRAME;
        let inSecondsTimestamp = (timestamp+compositionOffset)/90000; //todo timescale
        let inMicrosecondsTimestamp = 1000000 * inSecondsTimestamp;
        const videoChunk = new EncodedVideoChunk({
            timestamp: inMicrosecondsTimestamp,
            type: isKey ? 'key' : 'delta',
            // duration: 2000000, //todo: calculate duration in Microseconds?
            data: frame
        });
        // console.log('EncodedVideoChunk.timestamp',inMicrosecondsTimestamp)
        self.postMessage({type: "videoChunk", videoChunk: videoChunk});
    }
}

function processStatus(e) {
    console.debug('Command received', e.data);
    //TODO: use streams from status
    socket.send(JSON.stringify({
        command: 'Play',
        streams: [{
            "type": "video",
            "offset": "1000",
            "steady": true,
            "stream": "video_ads/stream",
            "sn": 0
        }, {"type": "audio", "offset": "1000", "steady": true, "stream": "video_ads/stream", "sn": 1}]
    }));
}

self.addEventListener('message', async function(e) {
    var type = e.data.type;

    // console.log("web_socket worker message received: ", type);

    if (type === "initWebSocket") {
        socket = new WebSocket(e.data.url, e.data.protocols);

        socket.binaryType = 'arraybuffer';

        socket.onmessage = ws_event => {
            if (ws_event.data instanceof ArrayBuffer) {
                processFrame(ws_event)
            } else {
                processStatus(ws_event)
            }
        }
    }
})

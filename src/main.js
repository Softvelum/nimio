import './style.css'
import { AudioRingBuffer } from './ring_buffer.js';

let audioContext;

function initNimio() {

    function processWorkerMessage(e) {
        var type = e.data.type;

        if (type === "videoFrame") {
            let frame = e.data.videoFrame;
            let frameTsUs = frame.timestamp;
            let currentPlayedTsUs = ringBuffer.getCurrentPlayedTsUs();
            let delayUs = frameTsUs - currentPlayedTsUs;
            if (delayUs < 0) {
                console.warn('late frame');
                delayUs = 0;
            }
            console.log(currentPlayedTsUs, frameTsUs, delayUs)
            setTimeout(function(){
                requestAnimationFrame(() => {
                    ctx.drawImage(frame, 0, 0);
                    frame.close();
                });
            }, delayUs / 1_000); // timeout in milliseconds
        } else if (type === "audioConfig") {
            audioDecoderWorker.postMessage({ type: "audioConfig", audioConfig: e.data.audioConfig });
        } else if (type === "audioFrame") {
            ringBuffer.pushAndPlay(e.data.audioFrame);
        } else if (type === "audioCodecData") {
            audioDecoderWorker.postMessage({ type: "codecData", codecData: e.data.codecData });
        } else if (type === "videoConfig") {
            videoDecoderWorker.postMessage({ type: "videoConfig", videoConfig: e.data.videoConfig });
        } else if (type === "videoCodecData") {
            videoDecoderWorker.postMessage({ type: "codecData", codecData: e.data.codecData });
        } else if (type === "audioChunk") {
            audioDecoderWorker.postMessage({ type: "audioChunk", audioChunk: e.data.audioChunk });
        } else if (type === "videoChunk") {
            videoDecoderWorker.postMessage({ type: "videoChunk", videoChunk: e.data.videoChunk });
        }
    }

    const videoDecoderWorker = new Worker(new URL('./decoders/decoder_video.js', import.meta.url), { type: 'module' });
    videoDecoderWorker.addEventListener('message', function (e) {
        processWorkerMessage(e);
    });

    const audioDecoderWorker = new Worker(new URL('./decoders/decoder_audio.js', import.meta.url), { type: 'module' });
    audioDecoderWorker.addEventListener('message', function (e) {
        processWorkerMessage(e);
    });

    const webSocketWorker = new Worker(new URL('./transport/web_socket.js', import.meta.url), { type: 'module' });
    webSocketWorker.addEventListener('message', function (e) {
        processWorkerMessage(e);
    });

    const videoCanvas = document.getElementById('video');
    const ctx = videoCanvas.getContext('2d');

    audioContext = new AudioContext({ latencyHint: "interactive" }); //TODO: set sampleRate param

    const ringBuffer = new AudioRingBuffer(100, audioContext);

    const streamURL = document.getElementById('streamURL').value;
    webSocketWorker.postMessage({type: 'initWebSocket', url: streamURL, protocols: ['sldp.softvelum.com'] });

}



document.getElementById('initNimioButton').addEventListener('click', initNimio);

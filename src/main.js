import './style.css'
import { AudioRingBuffer } from './ring_buffer.js';

let audioContext;

function ran_all() {

    function processWorkerMessage(e) {
        var type = e.data.type;

        // console.log("message from worker: ", type);

        if (type === "videoFrame") {
            // console.log('audioContext.currentTime', audioContext.currentTime)
            let frame = e.data.videoFrame;
            // console.log('decoded frame.timestamp', frame.timestamp)
            let frameTimestampMicroseconds = frame.timestamp;
            let currentPlayedTimestampMicroseconds = ringBuffer.getCurrentPlayedTS();
            let ts_diff = frameTimestampMicroseconds - currentPlayedTimestampMicroseconds;
            if (ts_diff < 0) {
                console.warn('late frame');
                ts_diff = 0;
            }
            // ts_diff = 0;
            console.log(currentPlayedTimestampMicroseconds, frameTimestampMicroseconds, ts_diff)
            setTimeout(function(){
                requestAnimationFrame(() => {
                    ctx.drawImage(frame, 0, 0);
                    frame.close();
                });
            }, ts_diff / 1000); // delay in milliseconds
        } else if (type === "audioFrame") {
            ringBuffer.pushAndPlay(e.data.audioFrame);
        } else if (type === "audioCodecData") {
            audioDecoderWorker.postMessage({ type: "codecData", codecData: e.data.codecData });
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

    // if (audioContext.state === "suspended") {
    //     document.addEventListener("click", () => audioContext.resume(), { once: true });
    // }

    const ringBuffer = new AudioRingBuffer(100, audioContext);



    webSocketWorker.postMessage({type: 'initWebSocket', url: "wss://vd1.wmspanel.com/video_demo_without_ads/stream", protocols: ['sldp.softvelum.com'] });

    // schedulePlayback();
}



document.getElementById('runAllButton').addEventListener('click', ran_all);

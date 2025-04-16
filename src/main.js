// 📁 src/main.js
import './style.css'

function ran_all() {

    function processWorkerMessage(e) {
        var type = e.data.type;

        console.log("message from worker: ", type);

        if (type === "videoFrame") {
            let frame = e.data.videoFrame;
            requestAnimationFrame(() => {
                ctx.drawImage(frame, 0, 0);
                frame.close();
            });
        } else if (type === "audioFrame") {
            scheduleAudioFrame(e.data.audioFrame);
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

    const audioContext = new (window.AudioContext || window.webkitAudioContext)({
        // sampleRate: 48000
    });

    let nextTime = audioContext.currentTime;
    function scheduleAudioFrame(audioFrame) {
        const duration = audioFrame.numberOfFrames / audioFrame.sampleRate;
        playAudioFrame(audioFrame, nextTime);
        nextTime += duration;
    }
    function playAudioFrame(audioFrame, when) {
        const source = audioContext.createBufferSource();
        source.buffer = createAudioBuffer(audioFrame);
        source.connect(audioContext.destination);
        source.start(when);
        audioFrame.close();
    }
    function createAudioBuffer(audioFrame) {
        const audioBuffer = audioContext.createBuffer(
            audioFrame.numberOfChannels,
            audioFrame.numberOfFrames,
            audioFrame.sampleRate
        );
        for (let channel = 0; channel < audioFrame.numberOfChannels; channel++) {
            const channelData = new Float32Array(audioFrame.numberOfFrames);
            audioFrame.copyTo(channelData, { planeIndex: channel, format: "f32-planar" });
            audioBuffer.getChannelData(channel).set(channelData);
        }
        return audioBuffer;
    }

    webSocketWorker.postMessage({type: 'initWebSocket', url: "wss://vd1.wmspanel.com/video_demo_without_ads/stream", protocols: ['sldp.softvelum.com'] });

}

document.getElementById('runAllButton').addEventListener('click', ran_all);

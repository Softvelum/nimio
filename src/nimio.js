import { AudioRingBuffer } from './ring_buffer.js';
import { parseAACConfig } from './utils/aac_config_parcer.js'

export class Nimio {
    constructor(videoElement, streamURL) {
        this.videoElement = videoElement;
        this.streamURL = streamURL;
        this.audioContext = null;
        this.videoDecoderWorker = null;
        this.audioDecoderWorker = null;
        this.webSocketWorker = null;

        this.initWorkers();

        this.videoCanvas = document.getElementById(this.videoElement);
        this.ctx = this.videoCanvas.getContext('2d');

        this.audioContext = new AudioContext({ latencyHint: "interactive" });

        this.ringBuffer = new AudioRingBuffer(100, this.audioContext);
    }

    initWorkers() {
        this.videoDecoderWorker = new Worker(new URL('./decoders/decoder_video.js', import.meta.url), { type: 'module' });
        this.videoDecoderWorker.addEventListener('message', (e) => {
            this.processWorkerMessage(e);
        });

        this.audioDecoderWorker = new Worker(new URL('./decoders/decoder_audio.js', import.meta.url), { type: 'module' });
        this.audioDecoderWorker.addEventListener('message', (e) => {
            this.processWorkerMessage(e);
        });

        this.webSocketWorker = new Worker(new URL('./transport/web_socket.js', import.meta.url), { type: 'module' });
        this.webSocketWorker.addEventListener('message', (e) => {
            this.processWorkerMessage(e);
        });
    }

    play() {
        this.webSocketWorker.postMessage({type: 'initWebSocket', url: this.streamURL, protocols: ['sldp.softvelum.com'] });
    }

    processWorkerMessage(e) {
        const type = e.data.type;

        if (type === "videoFrame") {
            let frame = e.data.videoFrame;
            let frameTsUs = frame.timestamp;
            let currentPlayedTsUs = this.ringBuffer.getCurrentPlayedTsUs();
            let delayUs = frameTsUs - currentPlayedTsUs;
            if (delayUs < 0) {
                console.warn('late frame');
                delayUs = 0;
            }
            console.log(currentPlayedTsUs, frameTsUs, delayUs)
            setTimeout(() => {
                requestAnimationFrame(() => {
                    this.ctx.drawImage(frame, 0, 0);
                    frame.close();
                });
            }, delayUs / 1_000); // timeout in milliseconds
        } else if (type === "audioConfig") {
            this.audioDecoderWorker.postMessage({ type: "audioConfig", audioConfig: e.data.audioConfig });
        } else if (type === "audioFrame") {
            this.ringBuffer.pushAndPlay(e.data.audioFrame);
        } else if (type === "audioCodecData") {
            const aacConfig = parseAACConfig(e.data.codecData);
            this.audioDecoderWorker.postMessage({ type: "codecData", codecData: e.data.codecData, aacConfig: aacConfig });
        } else if (type === "videoConfig") {
            this.videoDecoderWorker.postMessage({ type: "videoConfig", videoConfig: e.data.videoConfig });
        } else if (type === "videoCodecData") {
            this.videoDecoderWorker.postMessage({ type: "codecData", codecData: e.data.codecData });
        } else if (type === "audioChunk") {
            this.audioDecoderWorker.postMessage({ type: "audioChunk", audioChunk: e.data.audioChunk });
        } else if (type === "videoChunk") {
            this.videoDecoderWorker.postMessage({ type: "videoChunk", videoChunk: e.data.videoChunk });
        }
    }
}

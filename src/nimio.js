import { parseAACConfig } from './utils/aac_config_parcer.js'
import workletUrl from './audio-worklet-processor.js?url';

export class Nimio {
    constructor(videoElement, streamURL) {
        this.videoElement = videoElement;
        this.streamURL = streamURL;
        this.audioContext = null;
        this.videoCanvas = document.getElementById(this.videoElement);
        this.ctx = this.videoCanvas.getContext('2d');
        this.firstFrameTsUs = null;
        this.initWorkers();
        this.workletReady = null;
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
            let currentPlayedTsUs = this.audioContext.currentTime*1_000_000 + this.firstFrameTsUs - (0.2*1_000_000); //todo: 0.2 sec NimioProcessor startThreshold
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
            this.handleAudioFrame(e.data.audioFrame);
        } else if (type === "audioCodecData") {
            const aacConfig = parseAACConfig(e.data.codecData);
            this.audioDecoderWorker.postMessage({ type: "codecData", codecData: e.data.codecData, aacConfig: aacConfig });
        } else if (type === "videoConfig") {
            this.videoDecoderWorker.postMessage({ type: "videoConfig", videoConfig: e.data.videoConfig });
        } else if (type === "videoCodecData") {
            this.videoDecoderWorker.postMessage({ type: "codecData", codecData: e.data.codecData });
        } else if (type === "audioChunk") {
            this.audioDecoderWorker.postMessage({
                type: "audioChunk",
                timestamp: e.data.timestamp,
                frameWithHeader: e.data.frameWithHeader,
                framePos: e.data.framePos
            }, [e.data.frameWithHeader]);
        } else if (type === "videoChunk") {
            this.videoDecoderWorker.postMessage({
                type: "videoChunk",
                timestamp: e.data.timestamp,
                chunkType: e.data.chunkType,
                frameWithHeader: e.data.frameWithHeader,
                framePos: e.data.framePos
            }, [e.data.frameWithHeader]);
        }
    }

    async handleAudioFrame(audioFrame) {
        // create AudioContext with correct sampleRate on first frame
        if (!this.audioContext) {
            this.audioContext = new AudioContext({ latencyHint: 'interactive', sampleRate: audioFrame.sampleRate });
            if (audioFrame.sampleRate !== this.audioContext.sampleRate) {
                console.error('Unsupported sample rate', audioFrame.sampleRate, this.audioContext.sampleRate)
            }
            // load processor
            this.workletReady = this.audioContext.audioWorklet.addModule(workletUrl);
            await this.workletReady;
        } else {
            // ensure module loaded
            await this.workletReady;
        }

        const channels = audioFrame.numberOfChannels;
        const frames = audioFrame.numberOfFrames;
        const interleaved = new Float32Array(frames * channels);

        if (audioFrame.format.endsWith('-planar')) {
            const planes = [];
            for (let c = 0; c < channels; c++) {
                const bytes = audioFrame.allocationSize({ planeIndex: c });
                const samples = bytes / Float32Array.BYTES_PER_ELEMENT;
                const planeBuf = new Float32Array(samples);
                audioFrame.copyTo(planeBuf, { planeIndex: c });
                planes.push(planeBuf);
            }
            for (let i = 0; i < frames; i++) {
                for (let c = 0; c < channels; c++) {
                    interleaved[i * channels + c] = planes[c][i] ?? 0;
                }
            }
        } else {
            audioFrame.copyTo(interleaved, { planeIndex: 0 });
        }

        if (!this.audioNode) {
            this.audioNode = new AudioWorkletNode(this.audioContext, 'nimio-processor', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [channels],
                processorOptions: {
                    sampleRate: audioFrame.sampleRate
                }
            });

            this.audioNode.connect(this.audioContext.destination);
        }

        if (null === this.firstFrameTsUs) {
            const audioContextCurrentTsSec = this.audioContext.currentTime;
            const audioContextCurrentTsUs = audioContextCurrentTsSec * 1_000_000;
            const audioFrameTsUs = audioFrame.timestamp;
            this.firstFrameTsUs = audioFrameTsUs-audioContextCurrentTsUs;
        }

        this.audioNode.port.postMessage(
            { buffer: interleaved, numberOfChannels: channels },
            [interleaved.buffer]
        );
        audioFrame.close();
    }
}

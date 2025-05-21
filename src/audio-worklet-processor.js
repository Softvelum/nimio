import {StateManager} from "./state_manager.js";

class NimioProcessor extends AudioWorkletProcessor {
    constructor (options) {
        super(options);
        this.stateManager = new StateManager(options.processorOptions.sab);
        this.sampleRate = options.processorOptions.sampleRate;
        this.channelCount = options.outputChannelCount[0];

        this.targetLatencyMs = options.processorOptions.latency;
        this.hysteresis = this.targetLatencyMs < 1000 ? 1.5 : 1;

        const bufferSec = Math.ceil((
            this.targetLatencyMs +
            options.processorOptions.startOffset +
            options.processorOptions.pauseTimeout +
        200) / 1000); // 200 overhead for fast audio

        this.bufferSize = this.sampleRate * this.channelCount * bufferSec;
        this.ringBuffer = new Float32Array(this.bufferSize);
        this.writeIndex = 0;
        this.readIndex  = 0;
        this.available  = 0;
        this.startThreshold = this.sampleRate * this.channelCount * this.targetLatencyMs/1000;
        this.speedFactor = 1.0;

        this.port.onmessage = ({data}) => {
            const chunk = new Float32Array(data.buffer);
            for (let i = 0; i < chunk.length; i++) {
                this.ringBuffer[(this.writeIndex + i) % this.bufferSize] = chunk[i];
                if ((this.readIndex === this.writeIndex + i) && (0 !== this.readIndex)) {
                    console.error('buffer overflow', this.readIndex, this.writeIndex + i)
                }
            }
            this.writeIndex = (this.writeIndex + chunk.length) % this.bufferSize;
            this.available += chunk.length;
            if (this.available > this.bufferSize) this.available = this.bufferSize;
        };
    }

    process (inputs, outputs) {
        const out   = outputs[0];
        const chCnt = out.length;
        const frame = out[0].length;
        const speed = this.speedFactor;

        if (this.stateManager.isStopped()) {
            return false; // stop processing
        }

        const durationUs = frame * 1e6 / this.sampleRate;

        if (
            this.stateManager.isPaused() ||
            (this.available < frame * chCnt * speed) ||
            (this.available < this.startThreshold)
        ) {
            // Insert silence
            for (let c = 0; c < chCnt; c++) {
                out[c].fill(0);
            }
            console.debug('Insert silence: ', durationUs / 1000);
            this.stateManager.incSilenceUs(durationUs);
        } else {
            this.startThreshold = 0;
            this.stateManager.incCurrentTsUs(durationUs * this.speedFactor);

            for (let c = 0; c < chCnt; c++) {
                const channelData = out[c];
                for (let i = 0; i < frame; i++) {
                    // nearest "skipped" sample
                    const srcSample = Math.floor(i * speed);
                    const idx = (this.readIndex + srcSample * chCnt + c) % this.bufferSize;
                    channelData[i] = this.ringBuffer[idx];
                }
            }

            const consumedSamples = Math.floor(frame * speed);
            this.readIndex = (this.readIndex + consumedSamples * chCnt) % this.bufferSize;
            this.available -= consumedSamples * chCnt;

            let availableMs = this.available / (this.sampleRate * this.channelCount) * 1000;
            if (availableMs <= this.targetLatencyMs) {
                if (this.speedFactor !== 1.0) {
                    this.speedFactor = 1.0;
                    // console.debug('speedFactor 1.0', availableMs, this.targetLatencyMs);
                }
            } else if (availableMs > this.targetLatencyMs * this.hysteresis) {
                if (this.speedFactor !== 1.1) {
                    this.speedFactor = 1.1; // speed boost
                    // console.debug('speedFactor 1.1', availableMs, this.targetLatencyMs);
                }
            }
            this.stateManager.setAvailableAudioSec(availableMs);
        }
        return true;
    }
}

registerProcessor('nimio-processor', NimioProcessor);

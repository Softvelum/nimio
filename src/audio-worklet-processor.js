import {StateManager} from "./state_manager.js";

class NimioProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super(options);
        this.stateManager = new StateManager(options.processorOptions.sab);
        this.sampleRate = options.processorOptions.sampleRate;
        this.channelCount = options.outputChannelCount[0];

        const bufferSec = Math.ceil((
            options.processorOptions.latency +
            options.processorOptions.startOffset +
            options.processorOptions.pauseTimeout +
        200) / 1000) // 200 overhead for fast audio

        this.bufferSize   = this.sampleRate * this.channelCount * bufferSec;
        this.ringBuffer   = new Float32Array(this.bufferSize);
        this.writeIndex   = 0;
        this.readIndex    = 0;
        this.available    = 0;
        this.startThreshold = this.sampleRate * this.channelCount * options.processorOptions.latency/1000;
        this.port.onmessage = ({data}) => {
            const chunk = new Float32Array(data.buffer);
            for (let i = 0; i < chunk.length; i++) {
                this.ringBuffer[(this.writeIndex + i) % this.bufferSize] = chunk[i];
                if (this.readIndex === this.writeIndex+i && 0 !== this.readIndex) { console.error('buffer overflow', this.readIndex, this.writeIndex+i) }
            }
            this.writeIndex  = (this.writeIndex + chunk.length) % this.bufferSize;
            this.available  += chunk.length;
            if (this.available > this.bufferSize) this.available = this.bufferSize;
        };
    }

    process(inputs, outputs) {
        const out   = outputs[0];
        const chCnt = out.length;
        const frame = out[0].length;

        if (this.stateManager.isStopped()) {
            return false; // stop processing
        }

        if (this.stateManager.isPaused() || this.available < frame * chCnt || this.available < this.startThreshold ) { // Insert silence
            for (let c = 0; c < chCnt; c++) out[c].fill(0);
            const durationUs = frame * 1e6 / sampleRate;
            this.stateManager.incSilenceUs(durationUs);
        } else {
            this.startThreshold = 0;

            for (let c = 0; c < chCnt; c++) {
                const channelData = out[c];
                for (let i = 0; i < frame; i++) {
                    channelData[i] = this.ringBuffer[(this.readIndex + i*chCnt + c) % this.bufferSize];
                }
            }
            this.readIndex  = (this.readIndex + frame*chCnt) % this.bufferSize;
            this.available -= frame*chCnt;
        }
        return true;
    }
}

registerProcessor('nimio-processor', NimioProcessor);

class NimioProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super(options);
        console.debug(options)
        this.sampleRate = options.processorOptions.sampleRate;
        this.channelCount = options.outputChannelCount[0];
        this.bufferSize   = this.sampleRate * this.channelCount * 5;  // 5 sec
        this.ringBuffer   = new Float32Array(this.bufferSize);
        this.writeIndex   = 0;
        this.readIndex    = 0;
        this.available    = 0;
        this.startThreshold = this.sampleRate * this.channelCount * 0.2;  // 0.2 sec TODO: config
        this.port.onmessage = ({data}) => {
            const chunk = new Float32Array(data.buffer);
            for (let i = 0; i < chunk.length; i++) {
                this.ringBuffer[(this.writeIndex + i) % this.bufferSize] = chunk[i];
                if (this.readIndex === this.writeIndex+i) { console.error('buffer overflow', this.readIndex, this.writeIndex+i) }
            }
            this.writeIndex  = (this.writeIndex + chunk.length) % this.bufferSize;
            this.available  += chunk.length;
            if (this.available > this.bufferSize) this.available = this.bufferSize;
        };
    }

    process(inputs, outputs) {
        const out   = outputs[0];
        const chCnt = out.length;
        const frame = out[0].length;  // almost 128

        if (this.available < frame * chCnt && this.available < this.startThreshold) { // Insert silence
            for (let c = 0; c < chCnt; c++) out[c].fill(0);
            console.debug('silens', this.available)
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

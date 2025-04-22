export class AudioRingBuffer {
    constructor(capacity, audioContext) {
        this.capacity = capacity;
        this.buffer = new Array(capacity);
        this.writeIndex = 0;
        this.readIndex = 0;
        this.size = 0;
        this.audioContext = audioContext;
        this.nextTime = 0;
        this.startThreshold = 10; //frames
        this.initialStartComplete = false;
        this.firstFrameTsUs = null;
    }

    getCurrentPlayedTsUs() {
        return (this.audioContext.currentTime*1_000_000 + this.firstFrameTsUs);
    }

    isEmpty() {
        return this.size === 0;
    }

    isFull() {
        return this.size === this.capacity;
    }

    canStart() {
        let can_start = !this.initialStartComplete && this.size >= this.startThreshold;
        if (can_start) {this.initialStartComplete = true}
        return can_start;
    }

    push(audioFrame) {
        if (this.isFull()) {
            console.warn("Buffer full, rewrite old frame", this.size, this.capacity);
            this.readIndex = (this.readIndex + 1) % this.capacity;
            this.size--;
        }

        this.buffer[this.writeIndex] = audioFrame;
        this.writeIndex = (this.writeIndex + 1) % this.capacity;
        this.size++;

        if (this.canStart()) {
            this.start();
        }
    }

    pop() {
        if (this.isEmpty()) {
            console.warn("Buffer empty");
            return null;
        }

        const audioFrame = this.buffer[this.readIndex];
        this.buffer[this.readIndex] = null; // cleanup
        this.readIndex = (this.readIndex + 1) % this.capacity;
        this.size--;
        return audioFrame;
    }

    playNextFrame() {
        const audioFrame = this.pop();
        if (!audioFrame) return;

        const audioBuffer = this.audioContext.createBuffer(
            audioFrame.numberOfChannels,
            audioFrame.numberOfFrames,
            audioFrame.sampleRate
        );

        for (let channel = 0; channel < audioFrame.numberOfChannels; channel++) {
            const channelData = new Float32Array(audioFrame.numberOfFrames);
            audioFrame.copyTo(channelData, {
                planeIndex: channel,
                format: "f32-planar"
            });
            audioBuffer.getChannelData(channel).set(channelData);
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);

        const duration = audioFrame.numberOfFrames / audioFrame.sampleRate;

        const audioFrameTsUs = audioFrame.timestamp;
        const audioContextCurrentTsSec = this.audioContext.currentTime;
        const audioContextCurrentTsUs = audioContextCurrentTsSec * 1_000_000;
        if (null === this.firstFrameTsUs) {
            this.firstFrameTsUs = audioFrameTsUs-audioContextCurrentTsUs;
        }

        if (this.nextTime < audioContextCurrentTsSec) {
            console.log('adjust this.nextTime', this.nextTime, audioContextCurrentTsSec)
            this.nextTime = audioContextCurrentTsSec
        }

        source.start(this.nextTime);

        this.nextTime += duration;

        audioFrame.close();

        if (!this.isEmpty()) {
            //todo calculate buffers sizes
            setTimeout(() => this.playNextFrame(), duration * 500);
        }
    }

    start() {
        if (this.audioContext.state === "suspended") {
            this.audioContext.resume().then(() => {
                console.log("AudioContext activated");
                if (!this.isEmpty()) {
                    this.playNextFrame();
                }
            });
        } else if (!this.isEmpty()) {
            this.playNextFrame();
        }
    }

    pushAndPlay(audioFrame) {
        const wasEmpty = this.isEmpty();
        this.push(audioFrame);
        if (wasEmpty && this.initialStartComplete) {
            this.start();
        }
    }
}

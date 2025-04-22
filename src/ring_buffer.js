export class AudioRingBuffer {
    constructor(capacity, audioContext) {
        this.capacity = capacity;
        this.buffer = new Array(capacity);
        this.write_index = 0;
        this.read_index = 0;
        this.size = 0;
        this.audioContext = audioContext;
        this.nextTime = 0;
        this.startThreshold = 10; //frames
        this.initialStartComplete = false;
        this.currentPlayedTS = 0;
        this.firstFrameTimestampMicrosecond = null;
    }

    getCurrentPlayedTS() {
        this.currentPlayedTS = this.audioContext.currentTime*1000000 + this.firstFrameTimestampMicrosecond;
        return this.currentPlayedTS;
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
            this.read_index = (this.read_index + 1) % this.capacity;
            this.size--;
        }

        this.buffer[this.write_index] = audioFrame;
        this.write_index = (this.write_index + 1) % this.capacity;
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

        const audioFrame = this.buffer[this.read_index];
        this.buffer[this.read_index] = null; // cleanup
        this.read_index = (this.read_index + 1) % this.capacity;
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

        let audioFrameTimestampMicroseconds = audioFrame.timestamp;
        let audioContextCurrentTimeMicroseconds = this.audioContext.currentTime*1000000;
        if (null === this.firstFrameTimestampMicrosecond) {
            this.firstFrameTimestampMicrosecond = audioFrameTimestampMicroseconds-audioContextCurrentTimeMicroseconds;
        }

        if (this.nextTime < audioContextCurrentTimeMicroseconds/1000000) {
            console.log('adjust this.nextTime', this.nextTime, audioContextCurrentTimeMicroseconds/1000000)
            this.nextTime = audioContextCurrentTimeMicroseconds/1000000
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

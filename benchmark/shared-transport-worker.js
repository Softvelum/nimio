importScripts("shared-ring-buffer.js");

self.onmessage = ({ data }) => {
  const { start, frameSize, numFrames, shared, meta, capacity } = data;
  if (!start) return;

  const ring = new SharedRingBuffer(shared, meta, capacity);

  let sent = 0;
  const sendFrame = () => {
    if (sent >= numFrames) {
      self.postMessage({ done: true, time: performance.now() - startTime });
      return;
    }

    const frame = new Uint8Array(frameSize);

    if (!ring.write(frame)) {
      setTimeout(sendFrame, 0);
      return;
    }

    sent++;
    setTimeout(sendFrame, 0);
  };

  const startTime = performance.now();
  sendFrame();
};


self.onmessage = ({ data }) => {
  const { start, frameSize, numFrames } = data;
  if (!start) return;

  let sent = 0;
  const sendFrame = () => {
    if (sent >= numFrames) {
      self.postMessage({ done: true, time: performance.now() - startTime });
      return;
    }

    const frame = new Uint8Array(frameSize);
    const buffer = frame.buffer;
    self.postMessage(buffer, [buffer]);

    sent++;
    setTimeout(sendFrame, 0);
  };

  const startTime = performance.now();
  sendFrame();
};


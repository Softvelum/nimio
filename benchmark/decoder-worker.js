importScripts("shared-ring-buffer.js");

let ring = null;

onmessage = ({ data }) => {
  if (data.init) {
    ring = new SharedRingBuffer(data.init.shared, data.init.meta, data.init.capacity);
    processFrames();
  }
};

function processFrames() {
  const result = ring?.acquire();
  if (result) {
    setTimeout(() => {
      ring.release(result.handle);
      processFrames();
    }, 0);
  } else {
    Atomics.wait(ring._meta, SharedRingBuffer.META_NOTIFY_FLAG, 0, 100);
    processFrames();
  }
}


const output = document.getElementById("output");
const NUM_FRAMES = 1000;
const FRAME_SIZE = 2048000;

function log(msg) {
  output.textContent += msg + "\n";
  console.log(msg);
}

document.getElementById("startTransfer").onclick = () => {
  output.textContent = "";
  startTransferBenchmark();
};

document.getElementById("startShared").onclick = () => {
  output.textContent = "";
  startSharedBenchmark();
};

// postMessage

function startTransferBenchmark() {
  const transport = new Worker("transport-worker.js");
  let startTime;

  transport.onmessage = (e) => {
    if (e.data.done) {
      const time = e.data.time;
      log(`postMessage done in ${time.toFixed(2)} ms`);
      transport.terminate();
    }
  };

  startTime = performance.now();
  transport.postMessage({ start: true, frameSize: FRAME_SIZE, numFrames: NUM_FRAMES });
}

// SharedRIngBuffer

async function startSharedBenchmark() {
  const CAPACITY = FRAME_SIZE * 100;

  const shared = new SharedArrayBuffer(CAPACITY);
  const meta = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 6);

  const transport = new Worker("shared-transport-worker.js");
  const decoder = new Worker("decoder-worker.js");

  transport.postMessage({ 
    start: true, 
    frameSize: FRAME_SIZE, 
    numFrames: NUM_FRAMES, 
    shared, 
    meta, 
    capacity: CAPACITY 
  });

  decoder.postMessage({ init: { shared, meta, capacity: CAPACITY } });

  transport.onmessage = (e) => {
    if (e.data.done) {
      log(`SharedArrayBuffer done in ${e.data.time.toFixed(2)} ms`);
      transport.terminate();
      decoder.terminate();
    }
  };
}


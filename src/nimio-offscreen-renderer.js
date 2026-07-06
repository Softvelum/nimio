import { NimioLiveContext } from "./nimio-live-context";
import { FrameBuffer } from "./media/buffers/frame-buffer";

var liveContext = null;
var videoBuffer = null;

let offscreenCanvas = null;
let offscreenCtx = null;
let canvasWidth = 0;
let canvasHeight = 0;
let rendProps = null;
let dpr = 1.0;
let bCanvas = null;
let bctx = null;
let prevRendProps = null;

self.onmessage = (e) => {
  let type = e.data.type;
  switch (type) {
    case "init":
      init(e.data.options);
      break;
    case "attachPort":
      liveContext.attachPort(e.data.port);
      break;
    case "state": 
      liveContext.stuffState(e.data.message);
      break;
    case "updateAudioConfig":
      liveContext.updateAudioConfig(e.data.config);
      break;
    case "updateLatency":
      liveContext.updateLatencyParams(e.data.params);
      break;
    case "sendPending":
      liveContext.sendPendingAdvertizerActions();
      break;
    case "trackAction":
      liveContext.onTrackAction(e.data.action);
      break;
    case "play":
      liveContext.play();
      break;
    case "pause":
      liveContext.pause();
      break;
    case "stop":
      liveContext.stop();
      break;
    case "resetPlayback":
      liveContext.resetPlayback();
      break;

    case "attach":
      liveContext.onAttach();

    case "setup":
      setup(e.data);
    case "resize":
      resize(e.data);
      break;
    case "clear":
      clear(e.data);
      break;
    case "videoFrame":
      pushFrame(e.data.frame);
      break;
    case "release":
      release();
  }
};

let init = (options) => {
  let config = JSON.parse(options.config);
  liveContext = new NimioLiveContext(options.instanceName, config, options.sab);
  videoBuffer = new FrameBuffer(options.instanceName, "VideoOffscreen", 1000);

  liveContext.onResponse = (msg) => postMessage(msg);
  liveContext.getFrame = (ts) => {
    return videoBuffer.popFrameForTime(ts);
  }
  liveContext.onDrawFrame = (frame) => draw(frame);
  liveContext.setStateSender( (msg) => {
    postMessage({type: "state", message: msg})
  });
}

let setup = (data) => {
  if (offscreenCanvas === null) {
    offscreenCanvas = data.canvas;
    offscreenCtx = offscreenCanvas.getContext("2d", { alpha: false });
    bCanvas = new OffscreenCanvas(0, 0);
    bctx = bCanvas.getContext("2d");
  }
  if (data.dpr != 0) {
    offscreenCtx.save();
    offscreenCtx.scale(data.dpr, data.dpr);
    offscreenCtx.restore();
    dpr = data.dpr;
  } else {
    dpr = 1.0;
  }
  if (data.rendProps) {
    rendProps = data.rendProps;
  }
};


let resize = (data) => {
  rendProps = data.rendProps;
  if (!rendProps) return;

  const dprWidth = rendProps.width * dpr;
  const dprHeight = rendProps.height * dpr;
  if (
    offscreenCanvas.width === dprWidth &&
    offscreenCanvas.height === dprHeight
  ) {
    return;
  }

  bCanvas.width = dprWidth;
  bCanvas.height = dprHeight;

  const prp = prevRendProps || rendProps;
  const rp = rendProps;
  prevRendProps = rp;
  bctx.drawImage(
    offscreenCanvas,
    prp.dx * dpr,
    prp.dy * dpr,
    prp.dWidth * dpr,
    prp.dHeight * dpr,
    0,
    0,
    rp.dWidth * dpr,
    rp.dHeight * dpr,
  );

  offscreenCanvas.width = dprWidth;
  offscreenCanvas.height = dprHeight;

  offscreenCtx.drawImage(
    bCanvas,
    0,
    0,
    rp.dWidth * dpr,
    rp.dHeight * dpr,
    rp.dx * dpr,
    rp.dy * dpr,
    rp.dWidth * dpr,
    rp.dHeight * dpr,
  );
};

let clear = () => {
  if (offscreenCanvas) {
    offscreenCtx.clearRect(0, 0, rendProps.width, rendProps.height);
  }
};

let pushFrame = (frame) => {
  videoBuffer.pushFrame(frame);
}

let draw = (data) => {
  let frame = data.frame;
  let rp = rendProps;
  if (frame === undefined || !rp) return;

  if (offscreenCanvas) {
    offscreenCtx.drawImage(
      frame,
      rp.dx * dpr,
      rp.dy * dpr,
      rp.dWidth * dpr,
      rp.dHeight * dpr,
    );
  }
  frame.close();
};

let release = (data) => {
  offscreenCanvas = undefined;
  offscreenCtx = undefined;
  rendProps = null;
};
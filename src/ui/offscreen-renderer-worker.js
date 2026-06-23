let offscreenCanvas = null;
let offscreenCtx = null;
let canvasWidth = 0;
let canvasHeight = 0;
let rendProps = {};
let dpr = 1.0;

self.onmessage = (e) => {
  let type = e.data.type;
  switch (type) {
    case "init":
      setup(e.data);
      break;
    case "resize":
      resize(e.data);
      break;
    case "clear":
      clear(e.data);
    case "videoframe":
      draw(e.data);
      break;
    case "release":
      release();
  }
};

let setup = (data) => {
  if (offscreenCanvas === null) {
    offscreenCanvas = data.canvas;
    offscreenCtx = offscreenCanvas.getContext("2d", { alpha: false });
  }
  if (data.dpr != 0 && data.dpr != 1) {
    // offscreenCtx.save();
    // offscreenCtx.scale(data.dpr, data.dpr);
    // offscreenCtx.restore();
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
  let dprWidth = rendProps.width * dpr;
  let dprHeight = rendProps.height * dpr;
  if (offscreenCanvas.width === dprWidth && offscreenCanvas.height === dprHeight) {
    return;
  }
  offscreenCanvas.width = dprWidth;
  offscreenCanvas.height = dprHeight;  
};

let clear = () => {
  if (offscreenCanvas) {
    offscreenCtx.clearRect(0, 0, rendProps.width, rendProps.height);
  }
};

let draw = (data) => {
  let frame = data.frame;
  if (frame === undefined) return;
  let rp = rendProps;
  if (!rp) return;

  if (offscreenCanvas) {
    offscreenCtx.drawImage(frame, rp.dx * dpr, rp.dy * dpr, rp.dWidth * dpr, rp.dHeight * dpr);
  }
  frame.close();
};

let release = (data) => {
  offscreenCanvas = undefined;
  offscreenCtx = undefined;
};

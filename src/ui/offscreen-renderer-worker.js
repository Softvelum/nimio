let offscreenCanvas = null;
let offscreenCtx = null;
let canvasWidth = 0;
let canvasHeight = 0;
let rendProps = null;
let dpr = 1.0;
let bCanvas = null;
let bctx = null;
let prevRendProps = null;

let grabberCanvas = null;
let grabberCtx = null;

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
    offscreenCtx.clearRect(0, 0, rendProps.width * dpr, rendProps.height * dpr);
  }
};

let draw = (data) => {
  let frame = data.frame;
  let rp = rendProps;
  if (frame === undefined || !rp) return;

  try {
    if (data.needScreenshot) {
      takeScreenshot(frame);
    }
    if (offscreenCanvas) {
      offscreenCtx.drawImage(
        frame,
        rp.dx * dpr,
        rp.dy * dpr,
        rp.dWidth * dpr,
        rp.dHeight * dpr,
      );
    }
  } finally {
    frame.close();
  }
};

let takeScreenshot = (frame) => {
  const w = frame.displayWidth;
  const h = frame.displayHeight;
  if (grabberCanvas === null) {
    grabberCanvas = new OffscreenCanvas(w, h);
    grabberCtx = grabberCanvas.getContext("2d", {
      willReadFrequently: true,
    });
  } else if (w !== offscreenCanvas.width || h !== offscreenCanvas.height) {
    grabberCanvas.width = w;
    grabberCanvas.height = h;
  }
  grabberCtx.drawImage(frame, 0, 0);
  const imageData = grabberCtx.getImageData(0, 0, w, h);
  postMessage({ data: imageData, pts: frame.timestamp }, [
    imageData.data.buffer,
  ]);
};

let release = (data) => {
  offscreenCanvas = undefined;
  offscreenCtx = undefined;
  grabberCanvas = undefined;
  grabberCtx = undefined;
  rp = null;
  self.close();
};

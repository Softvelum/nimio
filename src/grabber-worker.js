let offscreenCanvas = null;
let offscreenCtx = null;

onmessage = (event) => {
  const w = event.data.width;
  const h = event.data.height;
  if (offscreenCanvas === null) {
    offscreenCanvas = new OffscreenCanvas(w, h);
    offscreenCtx = offscreenCanvas.getContext("2d", {
      willReadFrequently: true,
    });
  } else {
    offscreenCanvas.width = w;
    offscreenCanvas.height = h;
  }

  // Can be either VideoFrame (for live) or ImageBitmap (for VOD) -
  // drawImage accepts both
  const bmp = event.data.bmp;
  offscreenCtx.drawImage(bmp, 0, 0);
  postMessage({
    data: offscreenCtx.getImageData(0, 0, w, h),
    pts: event.data.pts,
  });

  bmp.close();
};

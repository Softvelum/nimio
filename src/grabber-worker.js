let offscreenCanvas = null;
let offscreenCtx = null;

onmessage = (event) => {
  const bmp = event.data.bmp;
  const w = bmp.width
  const h = bmp.height
  if (offscreenCanvas === null) {
    offscreenCanvas = new OffscreenCanvas(w, h);
    offscreenCtx = offscreenCanvas.getContext('2d', {willReadFrequently: true});
  } else {
    offscreenCanvas.width = w;
    offscreenCanvas.height = h;
  }

  offscreenCtx.drawImage(bmp, 0, 0);
  postMessage({
    data: offscreenCtx.getImageData(0, 0, w, h),
    pts: event.data.pts
  });

  bmp.close();
};

let offscreenCanvas = null;
let offscreenCtx = null;

onmessage = (event) => {
  const bmp = event.data.bmp;
  if (offscreenCanvas === null) {
    offscreenCanvas = new OffscreenCanvas(bmp.width, bmp.height);
    offscreenCtx = offscreenCanvas.getContext('2d', {willReadFrequently: true});
  } else {
    offscreenCanvas.width = bmp.width;
    offscreenCanvas.height = bmp.height;
  }

  offscreenCtx.drawImage(bmp, 0, 0);
  postMessage({
    data: offscreenCtx.getImageData(0, 0, bmp.width, bmp.height),
    pts: event.data.pts
  });

  bmp.close();
};

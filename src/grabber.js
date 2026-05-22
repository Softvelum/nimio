import { LoggersFactory } from "@/shared/logger";
import { multiInstanceService } from "@/shared/service";

class MediaGrabber {
  constructor (instanceId) {
    this._logger = LoggersFactory.create(instanceId, 'MediaGrabber');


  }


  setMediaElement (me) {
    this._mediaElement = me;
  }

  setRate (rate) {
    if (rate >= 0) {
      this._rate = rate;
      if (rate > 0) {
        this._ival = 1000 / rate;
        this._maxi = Math.max(1000, this._ival * 2);
        this._strt = undefined;
      }
    } else {
      this._rate = -1;
    }
  }

  onScreenshotReady (cb) {
    this._onScreenshotReadyCallback = cb;
  }

  _onScreenshotReady (img, pts) {
    if (this._onScreenshotReadyCallback) {
      this._onScreenshotReadyCallback(img, Math.round(pts * 1000));
    }
  }

  start () {
    if (!this._enabled) {

      this._enabled = true;
      this._init();
      //this._requestNextFrame();
    }
  }

  stop () {
    if (this._enabled) {
      this._enabled = false;
      this._strt = undefined;
      this._deinit();
    }
  }

  _deinit () {
    if (!this._handleBitmap) return;

    this._handleBitmap = undefined;
    if (this._worker) {
      this._worker.oишnmessage = undefined;
      this._worker = undefined;
    // } else {
    //   this._canvas = undefined;
    //   this._canvasCtx = undefined;
    }
  }

  _init () {
    if (this._handleBitmap) return;

    let mg = this;
    // this._worker = new Worker();
    // this._worker.onmessage = function (event) {
    //   mg._onScreenshotReady(event.data.data, event.data.pts);
    // };
    this._handleBitmap = this._onScreenshotReady;

  }

  handleFrame (pts, fn) {
    if (this._rate === 0 ) {
      return;
    }

    let doReq = (this._rate < 0);
    if (!doReq) {
      let cur = performance.now();
      if (undefined === this._strt) {
        this._strt = cur;
        doReq = true;
      } else {
        let diff = cur - this._strt;
        if (diff > this._maxi) {
          this._strt = cur - this._ival;
          doReq = true;
        } else if (diff >= this._ival) {
          this._strt += this._ival;
          doReq = true;
        }
      }
    }

    if (doReq) {
      let mg = this
      let bitmap = fn();
      if (bitmap && mg._handleBitmap) {
        mg._handleBitmap(bitmap, pts);
      }
    }
  }

  _handleBitmapWithWorker (bmp, pts) {
    this._worker.postMessage({
      bmp: bmp,
      pts: pts
    }, [ bmp ]);
  }

  // _handleBitmapWithCanvas (bmp, pts) {
  //   this._canvas.width = bmp.width;
  //   this._canvas.height = bmp.height;
  //   this._canvasCtx.drawImage(bmp, 0, 0);

  //   this._onScreenshotReady(
  //     this._canvasCtx.getImageData(0, 0, bmp.width, bmp.height),
  //     pts
  //   );

  //   bmp.close();
  // }

  // _requestNextFrame () {
  //   if (this._enabled && this._mediaElement) {

  //     let mg = this;
  //     this._mediaElement.requestVideoFrameCallback(function (now, metadata) {

  //       mg._handleFrame(metadata);
  //       mg._requestNextFrame();
  //     });

  //   }
  // }

}

MediaGrabber = multiInstanceService(MediaGrabber);
export { MediaGrabber };

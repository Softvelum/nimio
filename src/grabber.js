import { LoggersFactory } from "@/shared/logger";
import { multiInstanceService } from "@/shared/service";
import { MODE } from "./shared/values";


class MediaGrabber {
  constructor (instanceId) {
    this._logger = LoggersFactory.create(instanceId, 'MediaGrabber');
  }

  setMode(mode) {
    this.vod = (mode == MODE.VOD);
  }

  setMediaElement (me) {
    this._mediaElement = me;
  }

  setRate (rate) {
    if (rate < 0) {
      this._rate = -1;
      return;
    }
    this._rate = rate;
    if (rate > 0) {
      this._ival = 1000 / rate;
      this._maxi = Math.max(1000, this._ival * 2);
      this._strt = undefined;
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

  start (mode) {
    if (mode !== null) {
      this.vod = (mode == MODE.VOD);
    }
    if (!this._enabled) {
      this._enabled = true;
      this._init();
      if (this.vod) {
        if (!this._worker) {
          let mg = this;
          this._worker = new Worker(new URL("grabber-worker.js", import.meta.url));
          this._worker.onmessage = function (event) {
            mg._onScreenshotReady(event.data.data, event.data.pts);
          };        
        }
        this._requestNextFrame();
      }
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
      this._worker.onmessage = undefined;
      this._worker = undefined;
    }
  }

  _init () {
    if (this._handleBitmap) return;

    let mg = this;
    if (this.vod) {

      this._handleBitmap = this._handleBitmapWithWorker;
    } else {
      this._handleBitmap = this._onScreenshotReady;
    }

  }

  isNeedFrame() {
    if (this._rate < 0) {
      return true
    }
    let cur = performance.now()
    if (undefined === this._strt) {
      this._strt = cur
      return true
    } 
    let diff = cur - this._strt
    if (diff > this._maxi) {
      this._strt = cur - this._ival
      return true
    }
    if (diff >= this._ival) {
      this._strt += this._ival
      return true
    }
    return false
  }

  handleLiveFrame (pts, fn) {
    if (!this.isNeedFrame()) return;
    let bitmap = fn();
    if (bitmap && this._handleBitmap) {
      this._handleBitmap(bitmap, pts);
    }
  }

  handleVodFrame(metadata) {
    if (metadata.presentedFrames <= 1 || !this.isNeedFrame()) {
      return;
    }
    let mg = this;
    let pts = metadata.mediaTime;
    createImageBitmap(this._mediaElement).then(function (bitmap) {
        if (bitmap && mg._handleBitmap) {
          mg._handleBitmap(bitmap, pts);
        }
      });
  }

  _handleBitmapWithWorker (bmp, pts) {
    this._worker.postMessage({
      bmp: bmp,
      pts: pts
    }, [ bmp ]);
  }

  _requestNextFrame () {
    if (this._enabled && this._mediaElement) {

      let mg = this;
      this._mediaElement.requestVideoFrameCallback((now, metadata) => {
        mg.handleVodFrame(metadata);
        mg._requestNextFrame();
      });
    }
  }
}

MediaGrabber = multiInstanceService(MediaGrabber);
export { MediaGrabber };

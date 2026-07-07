import { LoggersFactory } from "@/shared/logger";
import { multiInstanceService } from "@/shared/service";
import { MODE } from "./shared/values";

class MediaGrabber {
  constructor(instanceId) {
    this._logger = LoggersFactory.create(instanceId, "MediaGrabber");
    this._vod = false;
  }

  setMediaElement(me) {
    this._mediaElement = me;
  }

  setRate(rate) {
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

  onScreenshotReady(cb) {
    this._onScreenshotReadyCallback = cb;
  }

  _onScreenshotReady(img, pts) {
    if (this._onScreenshotReadyCallback) {
      this._onScreenshotReadyCallback(img, Math.round(pts * 1000));
    }
  }

  start(mode) {
    if (mode !== null) {
      this._vod = MODE.VOD === mode;
    }
    if (this._enabled) {
      return;
    }
    this._enabled = true;
    this._init();
    if (this._vod) {
      this._requestNextFrame();
    }
  }

  stop() {
    if (this._enabled) {
      this._enabled = false;
      this._strt = undefined;
      if (this._frameCallbackId !== undefined) {
        this._mediaElement?.cancelVideoFrameCallback(this._frameCallbackId);
        this._frameCallbackId = undefined;
      }
      this._deinit();
    }
  }

  _deinit() {
    this._vod = false;
    if (!this._handleBitmap) return;

    this._handleBitmap = undefined;
    if (this._worker) {
      this._worker.onmessage = undefined;
      this._worker.terminate();
      this._worker = undefined;
    }
  }

  _init() {
    if (this._handleBitmap) return;

    let mg = this;
    this._worker = new Worker(new URL("grabber-worker.js", import.meta.url));
    this._worker.onmessage = function (event) {
      mg._onScreenshotReady(event.data.data, event.data.pts);
    };
    this._handleBitmap = this._handleBitmapWithWorker;
  }

  isNeedFrame() {
    if (this._rate < 0) {
      return true;
    }
    if (this._rate === 0 || !this._enabled) {
      return false;
    }
    const cur = performance.now();
    if (undefined === this._strt) {
      this._strt = cur;
      return true;
    }
    let diff = cur - this._strt;
    if (diff > this._maxi) {
      this._strt = cur - this._ival;
      return true;
    }
    if (diff >= this._ival) {
      this._strt = cur;
      return true;
    }
    return false;
  }

  handleLiveFrame(frame) {
    if (!this.isNeedFrame()) return;
    this._handleBitmap(
      frame,
      frame.timestamp,
      frame.displayWidth,
      frame.displayHeight,
    );
  }

  _handleVodFrame(metadata) {
    if (metadata.presentedFrames <= 1 || !this.isNeedFrame()) {
      return;
    }
    let mg = this;
    const pts = metadata.mediaTime;
    createImageBitmap(this._mediaElement)
      .then((bitmap) => {
        if (bitmap) {
          if (mg._handleBitmap) {
            mg._handleBitmap(bitmap, pts, bitmap.width, bitmap.height);
          } else {
            // Seems grabber was stopped during request
            bitmap.close();
          }
        }
      })
      .catch((error) => {
        mg._logger.warn("Failed to capture bitmap", error);
      });
  }

  _handleBitmapWithWorker(bmp, pts, width, height) {
    this._worker.postMessage(
      {
        bmp: bmp,
        pts: pts,
        width: width,
        height: height,
      },
      [bmp],
    );
  }

  _requestNextFrame() {
    if (!(this._enabled && this._mediaElement)) {
      return;
    }

    let mg = this;
    this._frameCallbackId = this._mediaElement.requestVideoFrameCallback(
      (now, metadata) => {
        mg._frameCallbackId = undefined;
        mg._handleVodFrame(metadata);
        if (mg._vod) {
          mg._requestNextFrame();
        }
      },
    );
  }
}

MediaGrabber = multiInstanceService(MediaGrabber);
export { MediaGrabber };

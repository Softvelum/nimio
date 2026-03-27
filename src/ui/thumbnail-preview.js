import { PlaybackThumbnailService } from "@/playback/thumbnail-service";
import { secondsToHumanClock } from "@/shared/time-helpers";

export class UIThumbnailPreview {
  constructor (instName, opts) {
    this._thumbnailService = PlaybackThumbnailService.getInstance(instName);
    this._thumbnailService.setBaseUrl(opts.baseUrl);
    this._create(opts);
  }

  destroy () {
    this._thumbnailService = undefined;
    this._inst = this._thumbWrp = this._thumb = this._thumbVideo =
    this._thumbTime = this._parent = undefined;
  }

  node () {
    return this._inst;
  }

  show (time, position, width) {
    if (!this._inst) return;

    if (this._showPreview) {
      if (this._thumbWidth === 0) {
        this.update({preview: true});
      }
      let url = this._thumbnailService.getUrl(time);
      if (url) this._thumbVideo.src = url;
    }

    let timeStr = secondsToHumanClock(time, "");
    this._thumbTime.textContent = timeStr;
    if (!this._showPreview) {
      this._thumbWidth = timeStr.length * 7;
      this._thumbTime.style.width = this._thumbWidth + "px";
    }

    let borderWidth = this._showPreview ? 2 : 0; // consider thumbnail border width
    let shiftX = position - this._thumbWidth / 2 + this._leftPos - borderWidth;
    if (shiftX < this._leftPos) shiftX = this._leftPos;

    let maxPos = width - this._thumbWidth + this._leftPos - borderWidth;
    if (shiftX > maxPos) shiftX = maxPos;

    this._inst.style.display = "block";
    this._thumbWrp.style.transform = "translate3d(" + shiftX + "px, 0px, 0px)"
  }

  update (opts) {
    if (!this._inst) return;

    debugger;
    this._showPreview = opts.preview;
    if (this._showPreview) {
      this._thumbWidth = Math.floor(this._parent.offsetWidth / 3.5);
      if (this._thumbWidth > 0) {
        if (this._thumbWidth > 500) this._thumbWidth = 500;

        this._thumb.style.display = "block";
        this._thumb.style.width = this._thumbWidth + "px";
        this._thumb.style.height = Math.floor(this._thumbWidth * 3 / 5) + "px";
        this._thumbTime.style.width = "auto";
      }
    } else {
      this._thumb.style.display = "none";
    }
  }

  hide () {
    if (!this._inst) return;
    this._inst.style.display = "none";
  }

  _create (opts) {
    if (this._inst) return;

    this._inst = document.createElement("div");
    this._inst.className = "thumbnails";
    this._inst.style.display = "none";
    this._thumbWrp = document.createElement("div");
    this._thumbWrp.className = "thumbnail-wrp";

    this._thumb = document.createElement("div");
    this._thumb.className = "thumbnail";

    this._thumbVideo = document.createElement("video");
    this._thumbVideo.className = "thumbnail-vid";

    this._thumbTime = document.createElement("div");
    this._thumbTime.className = "thumbnail-time";

    this._thumb.appendChild(this._thumbVideo);
    this._thumbWrp.appendChild(this._thumb);
    this._thumbWrp.appendChild(this._thumbTime);
    this._inst.appendChild(this._thumbWrp);

    this._leftPos = opts.left;
    this._parent = opts.parent;

    this.update(opts);
  }
}

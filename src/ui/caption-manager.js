import { multiInstanceService } from '@/shared/service';
import { CaptionRenderer } from '@/captions/renderer';

class UICaptionManager {
  constructor (instName) {
    this._instName = instName;
    this._captions = {};
    this._captionRenderer = CaptionRenderer.getInstance(instName);
  }

  init (container) {
    if (container && !this._captionsWrp) {
      this._captionsWrp = this._captionRenderer.createCaptionsWrapper();
      container.appendChild(this._captionsWrp);
      this._container = container;

      this._resizeObserver = new ResizeObserver(() => {
        this._setCaptionsFontSize();
      });
      this._resizeObserver.observe(this._captionsWrp);
    }
  }

  setCaptionTrack (id) {
    this._clearActiveCaptions(true);

    if (this._container && id) {
      if (!this._captions[id]) {
        this._captions[id] = this._captionRenderer.createCaptionTrackWrapper(id);
        this._captionsWrp.appendChild(this._captions[id]);
      } else {
        this._captions[id].style.visibility = 'visible';
      }
    }

    this._activeCaptionId = id;
    this._setCaptionsFontSize();
  }

  clear () {
    this._clearActiveCaptions();
  }

  deinit () {
    if (this._container) {
      try {
        this._resizeObserver.unobserve(this._captionsWrp);
        this._container.removeChild(this._captionsWrp);
      } catch (err) {}
      this._captionsWrp = undefined;
      this._container = undefined;

      this._clearActiveCaptions(true);
      this._captions = {};
    }
  }

  addActiveCaption (caption) {
    this._captions[this._activeCaptionId].appendChild(caption);
  }

  removeActiveCaption (caption) {
    this._captions[this._activeCaptionId].removeChild(caption);
  }

  _setCaptionsFontSize () {
    if (!this._activeCaptionId) {
      return;
    }

    let actCaps = this._captions[this._activeCaptionId];
    if (actCaps) {
      let capSize = this._captionRenderer.getDimensions();
      if (capSize[0] > 0 && capSize[1] > 0) {
        let wrpRect = actCaps.getBoundingClientRect();
        let fSize = Math.min(
          wrpRect.height / capSize[0],
          wrpRect.width / capSize[1]
        );

        actCaps.style.fontSize = `${fSize}px`;
      }
    }
  }

  _clearActiveCaptions (hide) {
    if (!this._activeCaptionId) {
      return;
    }

    let actCaps = this._captions[this._activeCaptionId];
    if (actCaps) {
      if (hide) {
        actCaps.style.visibility = 'hidden';
      }
      try {
        while( actCaps.firstChild ) {
          actCaps.removeChild( actCaps.firstChild );
        }
      } catch (err) {}
    }
  }

}

UICaptionManager = multiInstanceService(UICaptionManager);
export { UICaptionManager };

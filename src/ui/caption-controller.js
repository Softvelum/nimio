import { multiInstanceService } from "@/shared/service";
import { CaptionPresenter } from "@/captions/presenter";
import { UICaptionManager } from "./caption-manager";

const idxToCC = ["CC1", "CC2", "CC3", "CC4"];
const ccToIdx = {
  CC1: 0,
  CC2: 1,
  CC3: 2,
  CC4: 3,
  OFF: -1,
};

class UICaptionController {
  constructor(instName) {
    this._captions = [];
    this._captionProps = [];
    this._activeIdx = -1;

    this._captionPresenter = CaptionPresenter.getInstance(instName);
    this._captionPresenter.setCaptionReportInterface(this);

    this._captionManager = UICaptionManager.getInstance(instName);
  }

  init(playerWrapper, settings) {
    if (typeof settings === "object") {
      for (var c in settings) {
        let cIdx = ccToIdx[c];
        if (cIdx >= 0) {
          this._captionProps[cIdx] = settings[c];
          if (settings[c].default) {
            this._activeIdx = cIdx;
          }
        }
      }
    }
    this._captionManager.init(playerWrapper);
    this._captionManager.setCaptionTrack(idxToCC[this._activeIdx]);

    this._captionPresenter.setRenderable(!!playerWrapper);
    if (this._activeIdx >= 0) {
      this._captionPresenter.start();
      this._captionPresenter.setActiveCaptionId(idxToCC[this._activeIdx]);
    }
  }

  deinit() {
    if (this._captionList) {
      this._captionList.destroy();
      this._captionList = undefined;
    }
    this._captionPresenter.deinit();
  }

  resume() {
    this._captionManager.clear();
    this._captionPresenter.start();
  }

  pause() {
    this._captionPresenter.stop();
  }

  clear() {
    this._captionManager.clear();
  }

  selectCaption(idx) {
    if ((this._captions[idx] || -1 === idx) && this._activeIdx !== idx) {
      this._activeIdx = idx;
      this._captionManager.setCaptionTrack(idxToCC[this._activeIdx]);
      this._captionPresenter.setActiveCaptionId(idxToCC[this._activeIdx]);
      this._captionList.activeIdx = idx;

      return true;
    }

    return false;
  }

  captionArrived(capId) {
    let idx = ccToIdx[capId];
    if (!this._captions[idx]) {
      this._captions[idx] = {};
      if (this._captionProps[idx] && this._captionProps[idx].name) {
        this._captions[idx].name = this._captionProps[idx].name;
      }
      if (this._captionProps[idx] && this._captionProps[idx].lang) {
        this._captions[idx].lang = this._captionProps[idx].lang;
      }
      this._captions[idx].title = this._captionList.getCaptionTitle(idx);

      this._captionList.refresh();
    }
  }

  setCaptionTrack(id) {
    return this.selectCaption(ccToIdx[id]);
  }

  getCurrentCaptionTrack() {
    let result = {};
    if (this._activeIdx >= 0) {
      result[idxToCC[this._activeIdx]] = this._captions[this._activeIdx];
    }

    return result;
  }

  getCaptionTracks() {
    let result = {};
    for (let i = 0; i < this._captions.length; i++) {
      if (this._captions[i]) {
        result[idxToCC[i]] = this._captions[i];
      }
    }

    return result;
  }

  set list(capList) {
    this._captionList = capList;
    this._captionList.captions = this._captions;
    this._captionList.userActionReportInterface = this;

    if (this._activeIdx >= 0) {
      this._captionList.activeIdx = this._activeIdx;
    }
  }
}

UICaptionController = multiInstanceService(UICaptionController);
export { UICaptionController };

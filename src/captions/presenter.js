import { multiInstanceService } from "@/shared/service";
import { CaptionRenderer } from "./renderer";
import { UICaptionManager } from "@/ui/caption-manager";
import { LoggersFactory } from "@/shared/logger";

class CaptionPresenter {
  constructor(instName) {
    this._captions = {};
    this._renderer = CaptionRenderer.getInstance(instName);
    this._captionManager = UICaptionManager.getInstance(instName);
    this._logger = LoggersFactory.create(instName, "Caption Presenter");
  }

  start() {
    if (!this._enabled) {
      this._enabled = true;

      if (this._renderable) {
        this._captions[this._activeCaptionId] = [];
        this._createDispatchTimer();
      }
    }
  }

  stop() {
    this._enabled = false;
    if (this._dispatchTimer) {
      clearTimeout(this._dispatchTimer);
      this._dispatchTimer = undefined;
    }
  }

  deinit() {
    this.stop();
    this._captions = {};
  }

  setActiveCaptionId(capId) {
    if (this._activeCaptionId !== capId) {
      if (this._activeCaptionId) {
        this._captions[this._activeCaptionId] = [];
      }
      this._activeCaptionId = capId;

      if (!this._activeCaptionId) {
        this.stop();
      } else if (!this._enabled) {
        this.start();
      }
    }
  }

  activateCaptionTrack(capId) {
    this._captionReport.captionArrived(capId);
  }

  addCaptions(capId, startTime, captionScreen) {
    if (!this._enabled || capId !== this._activeCaptionId) {
      return;
    }

    // let curTime = this._getCurrentTime();
    // this._logger.debug(captionScreen.getDisplayText(), startTime, curTime);

    let capRegions =
      this._renderer.createCaptionRegionsFromScreen(captionScreen);
    if (this._onCaptionsArrived) {
      this._onCaptionsArrived(
        this._buildApiCaptionsArrayFrom(capRegions, startTime),
        Math.floor(this._getCurrentTime()),
      );
    }

    // caption rendering part
    if (!this._renderable) {
      return;
    }

    if (!this._captions[capId]) {
      this._captions[capId] = [];
    }

    let captionsArray = this._renderer.createHTMLCaptionsFromRegions(
      capRegions,
      startTime,
      -1,
    );
    this._captions[capId] = this._captions[capId].concat(captionsArray);

    this._dispatchCaptions();
  }

  updateCaptions(capId, startTime, endTime, captionScreen, isEmpty) {
    if (
      !this._enabled ||
      !this._renderable ||
      capId !== this._activeCaptionId
    ) {
      return;
    }

    let captions = this._captions[this._activeCaptionId];
    if (!captions || captions.length === 0) {
      return;
    }

    if (isEmpty && this._onCaptionsArrived) {
      this._onCaptionsArrived(
        this._buildEmptyApiCaptionsArray(endTime),
        Math.floor(this._getCurrentTime()),
      );
    }

    for (let i = 0; i < captions.length; i++) {
      if (captions[i].end === -1) {
        if (captions[i].start !== startTime) {
          this._logger.warn(
            "Orphan caption detected",
            captionScreen.getDisplayText(),
          );
        }
        captions[i].end = endTime;
      }
    }
  }

  set currentTimeFn(fn) {
    this._getCurrentTime = fn;
  }

  set renderable(val) {
    this._renderable = val;
  }

  set captionReportInterface(iface) {
    this._captionReport = iface;
  }

  set onCaptionsArrived(handler) {
    this._onCaptionsArrived = handler;
  }

  _buildApiCaptionsArrayFrom(capRegions, startTime) {
    let apiCaps = [];
    for (let i = 0; i < capRegions.length; i++) {
      let cap = {
        time: startTime,
        x: capRegions[i].x,
        y1: capRegions[i].y1,
        y2: capRegions[i].y2,
        regions: [],
      };
      for (let j = 0; j < capRegions[i].p.length; j++) {
        let reg = { spans: [] };

        let capSpans = capRegions[i].p[j].spans;
        for (let k = 0; k < capSpans.length; k++) {
          reg.spans.push({
            row: capSpans[k].row,
            content: capSpans[k].line.trim(),
            style: this._renderer.getRegionSpanStyle(capSpans[k].name),
          });
        }
        cap.regions.push(reg);
      }
      apiCaps.push(cap);
    }

    return apiCaps;
  }

  _buildEmptyApiCaptionsArray(time) {
    return [
      {
        time: time,
        x: 0,
        y1: 0,
        y2: 0,
        regions: [],
      },
    ];
  }

  _createDispatchTimer() {
    let presenter = this;
    this._dispatchTimer = setTimeout(function () {
      this._dispatchTimer = undefined;
      if (presenter._enabled) {
        presenter._dispatchCaptions();
        presenter._createDispatchTimer();
      }
    }, 50);
  }

  _dispatchCaptions() {
    let captions = this._captions[this._activeCaptionId];
    if (!captions || captions.length === 0) {
      return;
    }

    let curTime = this._getCurrentTime();
    let updCaptions = [];
    for (let i = 0; i < captions.length; i++) {
      if (curTime >= captions[i].start && !captions[i].added) {
        this._captionManager.addActiveCaption(captions[i].capHTMLElement);
        captions[i].added = true;
      } else if (-1 !== captions[i].end && captions[i].end <= curTime) {
        if (captions[i].added) {
          try {
            this._captionManager.removeActiveCaption(
              captions[i].capHTMLElement,
            );
          } catch (err) {
            this._logger.error("Error removing active caption", err);
          }
        }
        continue;
      }
      updCaptions.push(captions[i]);
    }
    this._captions[this._activeCaptionId] = updCaptions;
  }
}

CaptionPresenter = multiInstanceService(CaptionPresenter);
export { CaptionPresenter };

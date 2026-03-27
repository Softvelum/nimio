import { multiInstanceService } from "@/shared/service";
import { PlaybackSegmentTracker } from "./segment-tracker";

class PlaybackThumbnailService {
  constructor (instName) {
    this._segmentTracker = PlaybackSegmentTracker.getInstance(instName);
    this._baseUrl = "./";
  }

  setBaseUrl(url) {
    this._baseUrl = url;
  }

  getUrl (time) {
    let res;

    let seg = this._segmentTracker.get(time);
    if (seg) {
      let thTime = Math.round(seg.programDateTime / 1000);
      res = this._baseUrl + thTime + ".mp4";
    }

    return res;
  }

  isSetUp () {
    return this._segmentTracker.isSetUp();
  }

}

PlaybackThumbnailService = multiInstanceService(PlaybackThumbnailService);
export { PlaybackThumbnailService };

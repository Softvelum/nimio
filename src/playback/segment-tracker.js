import { multiInstanceService } from "@/shared/service";
// import { LoggersFactory } from "@/shared/logger";

class PlaybackSegmentTracker {
  constructor (instName) {
    // this._logger = LoggersFactory.create(instName, 'Segment tracker');
  }

  isSetUp () {
    return this._segments && this._segments.length > 0;
  }

  setup (segments) {
    if (segments && segments.length > 0 && segments[0].programDateTime > 0) {
      this._segments = segments;
    }
  }

  get (time) {
    let res;
    if (!this._segments) return res;

    let left = 0;
    let right = this._segments.length - 1;
    while (left <= right) {
      let cur = Math.floor((left + right) / 2);
      let seg = this._segments[cur];
      if (seg.start <= time && time < seg.start + seg.duration) {
        res = seg;
        break;
      } else if (time < seg.start) {
        right = cur - 1;
      } else {
        left = cur + 1;
      }
    }

    return res;
  }

}

PlaybackSegmentTracker = multiInstanceService(PlaybackSegmentTracker);
export { PlaybackSegmentTracker };

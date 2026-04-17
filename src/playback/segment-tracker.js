import { multiInstanceService } from "@/shared/service";
// import { LoggersFactory } from "@/shared/logger";

class PlaybackSegmentTracker {
  constructor(instName) {
    // this._logger = LoggersFactory.create(instName, 'Segment tracker');
  }

  isSetUp() {
    return this._segments && this._segments.length > 0;
  }

  setup(segments) {
    this._segments = undefined;
    if (segments && segments.length > 0 && segments[0].programDateTime > 0) {
      this._segments = segments;
      this._ensureSorted();
    }
  }

  get(time) {
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

  _ensureSorted() {
    let isSorted = true;
    for (let i = 0; i < this._segments.length - 1; i++) {
      if (this._segments[i].start > this._segments[i + 1].start) {
        isSorted = false;
        break;
      }
    }
    if (!isSorted) {
      this._segments.sort((a, b) => a.start - b.start);
    }
  }
}

PlaybackSegmentTracker = multiInstanceService(PlaybackSegmentTracker);
export { PlaybackSegmentTracker };

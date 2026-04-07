import { multiInstanceService } from "@/shared/service";
// import { SPSHolder } from "@/sps/holder";
import { AVC_NAL_UNIT_TYPE, HEVC_NAL_UNIT_TYPE } from "./unit-type";
import { LoggersFactory } from '@/shared/logger';

class NalProcessor {
  constructor(instName) {
    this._instId = instName;
    this._logger = LoggersFactory.create(instName, 'NAL Processor');
    // this._spsHolder = SPSHolder.getInstance(instName);

    this._handlers = {};
    this._ordered = [];
    this._stashed = [];
    this._frameSeqEndTime = 0;
  }

  setCodec(codec) {
    this._codec = codec;
    // this._spsHolder.setCodec(codec);
  }

  addNalHandler(handler, type) {
    this._handlers[type] = handler;
  }

  handleFrame(data) {
    if (this._handlers.length === 0) {
      return [data];
    }

    if (data.pts === undefined) {
      // TODO: move this to a separate processor
      // this._spsHolder.parseDecoderConfig(data.codecData);
      return [data];
    }

    let processed = [];
    if (data.pts > this._frameSeqEndTime && this._ordered.length > 0) {
      for (let i = 0; i < this._ordered.length; i++) {
        this._process(this._ordered[i].pts, this._ordered[i].frame);
      }
      this._ordered = [];
      processed = this._stashed;
      this._stashed = [];
    }

    this._addToOrdered(data);
    this._stashed.push(data);
    return processed;
  }

  reset() {
    for (let t in this._handlers) {
      this._handlers[t].reset();
    }

    this._ordered = [];
    this._stashed = [];
    this._frameSeqEndTime = 0;
  }

  _addToOrdered(data) {
    let idx = this._ordered.length - 1;
    while (idx >= 0 && this._ordered[idx].pts > data.pts) idx--;
    this._ordered.splice(idx + 1, 0, data);
    if (data.pts > this._frameSeqEndTime) {
      this._frameSeqEndTime = data.pts;
    }
  }

  _process(pTime, frame) {
    let curIdx = 0;
    while (curIdx < frame.byteLength - 4) {
      let nalSize =
        (frame[curIdx] << 24) |
        (frame[curIdx + 1] << 16) |
        (frame[curIdx + 2] << 8) |
        frame[curIdx + 3];
      curIdx += 4;

      let nalu, type, start;
      if (this._codec === "H264") {
        let shift = 1;

        nalu = frame[curIdx] & 0x1f;
        if (nalu === AVC_NAL_UNIT_TYPE.SPS) {
          type = "SPS";
        } else if (nalu === AVC_NAL_UNIT_TYPE.SEI) {
          type = "SEI";
        } else if (nalu === AVC_NAL_UNIT_TYPE.AUD && nalSize > 7) {
          // SEI message is inside the Access unit delimiter (not sure it's H.264 compliant but that's how it work in Larix and Nimble)
          // The structure is the following AUD (1 byte type + 1 byte content) + 0001 (4 bytes separator) + SEI (the rest of the Nal unit)
          let sepStart = curIdx + 2;
          if (
            frame[sepStart] === 0 &&
            frame[sepStart + 1] === 0 &&
            frame[sepStart + 2] === 0 &&
            frame[sepStart + 3] === 1 &&
            frame[sepStart + 4] === AVC_NAL_UNIT_TYPE.SEI
          ) {
            type = "SEI";
            shift = 7;
          }
        }
        start = curIdx + shift;
      } else if (this._codec === "H265") {
        nalu = (frame[curIdx] >> 1) & 0x3f;
        if (nalu === HEVC_NAL_UNIT_TYPE.SPS) {
          type = "SPS";
        } else if (
          nalu === HEVC_NAL_UNIT_TYPE.SEI_PREFIX ||
          nalu === HEVC_NAL_UNIT_TYPE.SEI_SUFFIX
        ) {
          type = "SEI";
        }
        start = curIdx + 2;
      }
      // this._logger.warn('Nal unit received', nalu, type );

      if (type === "SPS") {
        // this._spsHolder.parseSPS(frame, start, curIdx + nalSize - 1);
      } else if (type && this._handlers[type]) {
        this._handlers[type].process(
          pTime,
          frame,
          start,
          curIdx + nalSize - 1,
          nalu,
        );
      }

      curIdx += nalSize;
    }
  }

  get codec() {
    return this._codec;
  }

  get type() {
    return "nal";
  }
}

NalProcessor = multiInstanceService(NalProcessor);
export { NalProcessor };

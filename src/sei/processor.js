import { multiInstanceService } from "@/shared/service";
import { NalReader } from "@/nal/reader";
// import { H264PicTimingProcessor } from "timecodes/h264_pic_timing_processor";
// import { H265TimeCodeProcessor } from "timecodes/h265_time_code_processor";
import { Cea608Processor } from "@/captions/cea608-processor";
import { LoggersFactory } from "@/shared/logger";

class SeiProcessor {
  constructor(instName) {
    this._instName = instName;
    this._handlers = [];
    this._logger = LoggersFactory.create(instName, "SEI Processor");
    this._type = "sei";
  }

  init() {
    this._handlers.length = 0;
  }

  setCodec(codec) {
    if (this._codec === codec) return;
    if (this._codec) this.init();
    this._codec = codec;
  }

  addCea608CaptionsHandler(captionPresenter) {
    this._captionPresenter = captionPresenter;
    this._handlers.push(
      new Cea608Processor(this._instName, this._captionPresenter),
    );
  }

  addPicTimingHandler() {
    let ptProcessor;
    // if (this._codec === "H264") {
    //   ptProcessor = new H264PicTimingProcessor(this._instName);
    // } else if (this._codec === "H265") {
    //   ptProcessor = new H265TimeCodeProcessor(this._instName);
    // }
    // this._handlers.push(ptProcessor);

    return ptProcessor;
  }

  getPicTimingHandler() {
    for (let i = 0; i < this._handlers.length; i++) {
      if (this._handlers[i].type === "timecode") {
        return this._handlers[i];
      }
    }
  }

  process(pTime, frame, start, end, naluType) {
    // Check SEI payload according to ANSI-SCTE 128
    let rbsp = NalReader.extractUnit(frame, start, end);
    let curPos = 0;
    let rbspLen = rbsp.length;
    while (curPos < rbspLen - 1) {
      // The last byte should be rbsp_trailing_bits
      let payloadType = 0;
      let b = 0xff;
      while (b === 0xff && curPos < rbspLen) {
        b = rbsp[curPos];
        payloadType += b;
        curPos++;
      }

      let payloadSize = 0;
      b = 0xff;
      while (b === 0xff && curPos < rbspLen) {
        b = rbsp[curPos];
        payloadSize += b;
        curPos++;
      }
      // this._logger.debug('SEI payload type = ' + payloadType + ' and payloadSize = ' + payloadSize);
      for (let i = 0; i < this._handlers.length; i++) {
        if (
          this._handlers[i].isMatching(
            payloadType,
            payloadSize,
            rbsp,
            curPos,
            naluType,
          )
        ) {
          this._handlers[i].handleUnit(pTime, rbsp, [curPos, payloadSize]);
          break;
        }
      }
      curPos += payloadSize;
    }
  }

  reset() {
    for (let i = 0; i < this._handlers.length; i++) {
      this._handlers[i].reset();
    }
  }

  get type() {
    return this._type;
  }
}

SeiProcessor = multiInstanceService(SeiProcessor);
export { SeiProcessor };

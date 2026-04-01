import { multiInstanceService } from '@/shared/service';
import ScriptPathProvider from 'shared/script_path_provider'
import H264PicTimingProcessor from 'timecodes/h264_pic_timing_processor'
import H265TimeCodeProcessor from 'timecodes/h265_time_code_processor'
import NalReader from 'shared/nal_reader'
import LoggersFactory from 'shared/logger'


class SeiProcessor {
  constructor (instName) {
    this._instId = instName;
    this._handlers = [];
    this._spProvider = ScriptPathProvider.getInstance(instName);
    this._logger = LoggersFactory.create(instName, 'SEI Processor');
    this.type = 'sei';
  }

  init () {
    this._handlers.length = 0;
  }

  setCodec (codec) {
    if (this._codec === codec) return;
    if (this._codec) {
      this.init();
    }
    this._codec = codec;
  }

  addCea608CaptionsHandler (captionPresenter) {
    this._captionPresenter = captionPresenter;

    let inst = this;
    this._spProvider.runWebpackImportUnderScriptPath(function () {
      import(/* webpackChunkName: "cea608-captions" */ 'captions/cea608_processor')
        .then(inst._onModuleAdded)
        .catch(inst._onModuleError);
    });
  }

  addPicTimingHandler () {
    let ptProcessor;
    if (this._codec === 'H264') {
      ptProcessor = new H264PicTimingProcessor(this._instId);
    } else if (this._codec === 'H265') {
      ptProcessor = new H265TimeCodeProcessor(this._instId);
    }
    this._handlers.push(ptProcessor);

    return ptProcessor;
  }

  getPicTimingHandler () {
    for (let i = 0; i < this._handlers.length; i++) {
      if (this._handlers[i].type === 'timecode') {
        return this._handlers[i];
      }
    }
  }

  _onModuleAdded = ({default: Cea608Processor}) => {
    this._logger.debug('CEA608 module is loaded');
    this._handlers.push(new Cea608Processor(this._instId, this._captionPresenter));
  };

  _onModuleError = (err) => {
    this._logger.error(
      this._spProvider.notAvailableError('CEA608 captions decoder', err.request)
    );
  };

  process (pTime, frame, start, end, naluType) {
    // Check SEI payload according to ANSI-SCTE 128
    let rbsp = NalReader.extractUnit(frame, start, end);
    let curPos = 0;
    while (curPos < rbsp.length - 1) { // The last byte should be rbsp_trailing_bits
      let payloadType = 0;
      let b = 0xFF;
      while (b === 0xFF) {
        b = rbsp[curPos];
        payloadType += b;
        curPos++;
      }

      let payloadSize = 0;
      b = 0xFF;
      while (b === 0xFF) {
        b = rbsp[curPos];
        payloadSize += b;
        curPos++;
      }
      // this._logger.debug('SEI payload type = ' + payloadType + ' and payloadSize = ' + payloadSize);
      for (let i = 0; i < this._handlers.length; i++) {
        if (this._handlers[i].isMatching(payloadType, payloadSize, rbsp, curPos, naluType)) {
          this._handlers[i].handleUnit(pTime, rbsp, [curPos, payloadSize]);
          break;
        }
      }
      curPos += payloadSize;
    }
  }

  reset () {
    for (let i = 0; i < this._handlers.length; i++) {
      this._handlers[i].reset();
    }
  }

}

SeiProcessor = multiInstanceService(SeiProcessor);
export { SeiProcessor };

import { multiInstanceService } from "@/shared/service";
import { PlaybackContext } from "@/playback/context";
import LoggersFactory from "@/shared/logger";

class AbrRenditionProvider {
  constructor(instanceName) {
    this._context = PlaybackContext.getInstance(instanceName);
    this._logger = LoggersFactory.create(
      instanceName,
      "ABR Rendition Provider",
    );
  }

  init(settings, size) {
    this._streams = this._context.streams;
    this._renditions = this._context.videoRenditions;
    this._maxHeight = settings.maxHeight || Number.MAX_VALUE;
    this._constrained = !!settings.sizeConstrained;

    this._filterRenditions(size);
  }

  getStream(idx) {
    return this._streams[idx];
  }

  getRendition(idx) {
    if (idx >= this._actualRenditions.length) {
      this._logger.error(`Irrelevant rendition = {idx} is requested`);
    }
    // TODO: change to actualRenditions after thorough testing
    return this._renditions[idx];
  }

  getRenditionName(idx) {
    return this.getRendition(idx).rendition + "p";
  }

  isTopAvailable(idx) {
    return idx >= this._actualRenditions.length - 1;
  }

  isRenditionActual(idx) {
    return idx < this._actualRenditions.length;
  }

  onSizeUpdate(size) {
    if (this._constrained) {
      this._filterRenditions(size);
    }
  }

  get streamsCount() {
    return this._streams.length;
  }

  get allRenditions() {
    return this._renditions;
  }

  get actualRenditions() {
    return this._actualRenditions;
  }

  _filterRenditions(size) {
    this._actualRenditions = [];
    for (let i = 0; i < this._renditions.length; i++) {
      let stream = this._streams[this._renditions[i].idx];
      if (stream.stream_info && stream.stream_info.height <= this._maxHeight) {
        if (
          this._constrained &&
          (stream.stream_info.width >= size[0] * 1.05 ||
            stream.stream_info.height >= size[1] * 1.05)
        ) {
          break;
        }

        this._actualRenditions.push(this._renditions[i]);
      }
    }
  }
}

AbrRenditionProvider = multiInstanceService(AbrRenditionProvider);
export { AbrRenditionProvider };

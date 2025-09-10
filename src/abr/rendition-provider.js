import LoggersFactory from "@/shared/logger";

class AbrRenditionProvider {
  constructor(instanceId) {
    this.instanceId = instanceId;
    this.logger = LoggersFactory.create(instanceId, "Rendition Provider");
  }

  init(streams, renditions, settings, size) {
    this.streams = streams;
    this.renditions = renditions;
    this.maxHeight = settings.max_height || Number.MAX_VALUE;
    this.constrained = !!settings.size_constrained;

    this._filterRenditions(size);
  }

  getStream(idx) {
    return this.streams[idx];
  }

  getStreamsCount() {
    return this.streams.length;
  }

  getRendition(idx) {
    if (idx >= this.actualRenditions.length) {
      this.logger.error(`Irrelevant rendition = {idx} is requested`);
    }
    return this.renditions[idx];
  }

  getRenditionName(idx) {
    return this.getRendition(idx).rendition + "p";
  }

  getAllRenditions() {
    return this.renditions;
  }

  getActualRenditions() {
    return this.actualRenditions;
  }

  isTopAvailable(idx) {
    return idx >= this.actualRenditions.length - 1;
  }

  isRenditionActual(idx) {
    return idx < this.actualRenditions.length;
  }

  onSizeUpdate(size) {
    if (this.constrained) {
      this._filterRenditions(size);
    }
  }

  _filterRenditions(size) {
    this.actualRenditions = [];
    for (let i = 0; i < this.renditions.length; i++) {
      let stream = this.streams[this.renditions[i].idx];
      if (stream.stream_info && stream.stream_info.height <= this.maxHeight) {
        if (
          this.constrained &&
          (stream.stream_info.width >= size[0] * 1.05 ||
            stream.stream_info.height >= size[1] * 1.05)
        ) {
          break;
        }

        this.actualRenditions.push(this.renditions[i]);
      }
    }
  }
}

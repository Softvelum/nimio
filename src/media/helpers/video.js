export class VideoHelper {

  static bin2str (data) {
    return String.fromCharCode.apply(null, data);
  }

  static readUint16 (buf, offset) {
    const val = (buf[offset] << 8) | buf[offset + 1];
    return val < 0 ? 65536 + val : val;
  }

  static readUint32 (buf, offset) {
    const val = this.readSint32(buf, offset);
    return val < 0 ? 4294967296 + val : val;
  }

  static readUint64 (buf, offset) {
    let result = this.readUint32(buf, offset);
    result *= Math.pow(2, 32);
    result += this.readUint32(buf, offset + 4);
    return result;
  }

  static readSint32 (buf, offset) {
    return (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
  }

  static findBox (data, path, count) {
    const results = [];
    if (!path.length) {
      // short-circuit the search for empty paths
      return results;
    }
    const end = data.byteLength;

    for (let i = 0; i < end; ) {
      const size = this.readUint32(data, i);
      const type = this.bin2str(data.subarray(i + 4, i + 8));
      const endbox = size > 1 ? i + size : end;
      if (type === path[0]) {
        if (path.length === 1) {
          // this is the end of the path and we've found the box we were looking for
          results.push(data.subarray(i + 8, endbox));
        } else {
          // recursively search for the next box along the path
          const subresults = this.findBox(
            data.subarray(i + 8, endbox),
            path.slice(1),
            count
          );
          if (subresults.length > 0) {
            push.apply(results, subresults);
          }
        }
        if (count > 0 && results.length >= count) break;
      }
      i = endbox;
    }

    return results;
  }

  static getCodecDataFromInitSegment (data) {
    let result, trackId, timescale;

    let path = ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd'];
    let psizes = [0, 0, 0, 0, 0, 8];
    let phase = 0;

    let segLength = data.byteLength;
    let offset = 0;
    while (offset + 8 < segLength && phase < path.length) {
      let boxl = this.readUint32(data, offset);
      let name = [];
      for (let i = 4; i < 8; i++) {
        name.push(String.fromCharCode(data[offset + i]));
      }
      name = name.join('');

      if (name === 'trak') {
        trackId = this._getValueFromBox(data.subarray(offset + 8), 'tkhd', 12);
      } else if (name === 'mdia') {
        timescale = this._getValueFromBox(data.subarray(offset + 8), 'mdhd', 12);
      }

      if (name !== path[phase]) {
        offset += boxl;
        continue;
      }

      offset += psizes[phase] + 8; // skip size, name and box content
      phase++;
      if (phase === path.length) {
        result = this.getCodecDataFromStsd(data.subarray(offset));
        result.trackId = trackId;
        result.timescale = timescale;
      }
    }

    return result;
  }

  static getCodecDataFromStsd (stsd, offset) {
    const sampleEntriesEnd = stsd.subarray(8 + 78);
    const fourCC = this.bin2str(stsd.subarray(4, 8));
    let codec = fourCC;
    const encrypted = fourCC === 'enca' || fourCC === 'encv';
    if (encrypted) {
      const encBox = this.findBox(stsd, [fourCC], 1)[0];
      const encBoxChildren = encBox.subarray(fourCC === 'enca' ? 28 : 78);
      const sinfs = this.findBox(encBoxChildren, ['sinf'], 1);
      for (let i = 0; i < sinfs.length; i++) {
        const schm = this.findBox(sinfs[i], ['schm'], 1)[0];
        if (schm) {
          const scheme = this.bin2str(schm.subarray(4, 8));
          if (scheme === 'cbcs' || scheme === 'cenc') {
            const frma = this.findBox(sinfs[i], ['frma'], 1)[0];
            if (frma) {
              // for encrypted content codec fourCC will be in frma
              codec = this.bin2str(frma);
            }
          }
        }
      }
    }

    let cData;
    codec = this.getVideoCodecGen(codec);
    switch (codec) {
    case 'H264':
      cData = this.findBox(sampleEntriesEnd, ['avcC'], 1)[0];
      break;
    case 'H265':
      cData = this.findBox(sampleEntriesEnd, ['hvcC'], 1)[0];
      break;
    default:
      // other codecs aren't supported yet
      break;
    }

    return { codec: codec, data: cData };
  }

  static getFramesFromDataSegment (data, timescale, trackId) {
    
    let result = [];

    let timeOffset = 0;
    const moofs = this.findBox(data, ['moof']);
    for (let i = 0; i < moofs.length; i++) {
      const moofOffset = moofs[i].byteOffset - 8;
      const trafs = this.findBox(moofs[i], ['traf']);
      for (let j = 0; j < trafs.length; j++) {
        let baseTime;
        const tfdts = this.findBox(trafs[j], ['tfdt']);
        for (let k = 0; k < tfdts.length; k++) {
          const version = tfdts[k][0];
          baseTime = this.readUint32(tfdts[k], 4);
          if (version === 1) {
            baseTime *= Math.pow(2, 32);
            baseTime += this.readUint32(tfdts[k], 8);
          }
          baseTime /= timescale;
        }

        if (baseTime !== undefined) {
          timeOffset = baseTime;
        }

        const tfhds = this.findBox(trafs[j], ['tfhd']);
        for (let k = 0; k < tfhds.length; k++) {
          let defaultSampleDuration = 0;
          let defaultSampleSize = 0;

          const id = this.readUint32(tfhds[k], 4);
          if (id !== trackId) continue;

          const tfhdFlags = this.readUint32(tfhds[k], 0) & 0xffffff;
          let tfhdOffset = 8;

          const baseDataOffsetPresent = (tfhdFlags & 0x000001) !== 0;
          if (baseDataOffsetPresent) {
            tfhdOffset += 8;
          }
          const sampleDescriptionIndexPresent = (tfhdFlags & 0x000002) !== 0;
          if (sampleDescriptionIndexPresent) {
            tfhdOffset += 4;
          }
          const defaultSampleDurationPresent = (tfhdFlags & 0x000008) !== 0;
          if (defaultSampleDurationPresent) {
            defaultSampleDuration = this.readUint32(tfhds[k], tfhdOffset);
            tfhdOffset += 4;
          }
          const defaultSampleSizePresent = (tfhdFlags & 0x000010) !== 0;
          if (defaultSampleSizePresent) {
            defaultSampleSize = this.readUint32(tfhds[k], tfhdOffset);
          }

          const truns = this.findBox(trafs[j], ['trun']);
          for (let n = 0; n < truns.length; n++) {
            const version = truns[n][0];
            const flags = this.readUint32(truns[n], 0) & 0xffffff;
            const sampleCount = this.readUint32(truns[n], 4);

            let sampleDuration = 0;
            let sampleSize = 0;
            let compositionOffset = 0;

            let trunOffset = 8; // past version, flags, and sample count
            let dataOffset = 0;
            const dataOffsetPresent = (flags & 0x000001) !== 0;
            if (dataOffsetPresent) {
              dataOffset = this.readUint32(truns[n], trunOffset);
              trunOffset += 4;
            }

            const firstSampleFlagsPresent = (flags & 0x000004) !== 0;
            if (firstSampleFlagsPresent) {
              trunOffset += 4;
            }

            let sampleOffset = dataOffset + moofOffset;

            const sampleDurationPresent = (flags & 0x000100) !== 0;
            const sampleSizePresent = (flags & 0x000200) !== 0;
            const sampleFlagsPresent = (flags & 0x000400) !== 0;
            const compositionOffsetsPresent = (flags & 0x000800) !== 0;
            for (let ix = 0; ix < sampleCount; ix++) {
              if (sampleDurationPresent) {
                sampleDuration = this.readUint32(truns[n], trunOffset);
                trunOffset += 4;
              } else {
                sampleDuration = defaultSampleDuration;
              }
              if (sampleSizePresent) {
                sampleSize = this.readUint32(truns[n], trunOffset);
                trunOffset += 4;
              } else {
                sampleSize = defaultSampleSize;
              }
              if (sampleFlagsPresent) {
                trunOffset += 4;
              }
              if (compositionOffsetsPresent) {
                if (version === 0) {
                  compositionOffset = this.readUint32(truns[n], trunOffset);
                } else {
                  compositionOffset = this.readSint32(truns[n], trunOffset);
                }
                trunOffset += 4;
              }

              const sample = data.subarray(sampleOffset, sampleOffset + sampleSize);
              let ts = timeOffset + compositionOffset / timescale;
              result.push([ts, sample]);

              sampleOffset += sampleSize;
              timeOffset += sampleDuration / timescale;
            }
          }

        }
      }
    }

    return result;
  }

  static getVideoCodecGen (codec) {
    let gen;
    if (!codec) return gen;

    let cPrefix = codec.substring(0, 4);
    switch( cPrefix ) {
      case 'avc1':
      case 'avc2':
      case 'avc3':
      case 'avc4':
        gen = 'H264';
        break;
      case 'hvc1':
      case 'hvc2':
      case 'hvc3':
      case 'hev1':
      case 'hev2':
      case 'hev3':
        gen = 'H265';
        break;
      case 'av01':
        gen = 'AV1';
        break;
      case 'vp08':
        gen = 'VP8';
        break;
      case 'vp09':
        gen = 'VP9';
        break;
      case 'dvh1':
      case 'dvhe':
        gen = 'DV';
        break;
      default:
        break;
    }

    return gen;
  }

  static _getValueFromBox (data, name, offset) {
    const box = this.findBox(data, [name], 1)[0];
    let version = box[0];
    return this.readUint32(box, version === 0 ? offset : offset + 8);
  }
}

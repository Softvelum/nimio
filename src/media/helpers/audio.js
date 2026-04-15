export function getAudioConfigFromInitSegment(codec, data) {
  let config = {};

  const cBoxName = codec === "mp3" ? ".mp3" : "mp4a";
  let path = ["moov", "trak", "mdia", "minf", "stbl", "stsd", cBoxName];
  let psizes = [0, 0, 0, 0, 0, 8, 16];
  let phase = 0;

  let segLength = data.byteLength;
  let offset = 0;
  while (offset + 8 < segLength && phase < path.length) {
    let boxl =
      (data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3];
    let name = [];
    for (let i = 4; i < 8; i++) {
      name.push(String.fromCharCode(data[offset + i]));
    }
    if (name.join("") !== path[phase]) {
      offset += boxl;
      continue;
    }

    offset += psizes[phase] + 8; // skip size, name and box content
    phase++;
    if (phase === path.length) {
      config.audioChannels = (data[offset] << 8) | data[offset + 1];
      offset += 8;
      config.samplingRate = (data[offset] << 8) | data[offset + 1];
    }
  }

  return config;
}

export class NalReader {
  static extractUnit (data, start, end) {
    const output = [];
    for (let i = start; i <= end; i++) {
      if (
        i > start + 1 &&
        data[i] === 0x03 &&
        data[i - 1] === 0x00 &&
        data[i - 2] === 0x00
      ) {
        // Skip emulation prevention byte
        continue;
      }
      output.push(data[i]);
    }

    return output;
  }
}

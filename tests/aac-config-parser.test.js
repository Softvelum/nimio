import { describe, it, expect } from "vitest";
import { parseAACConfig } from "@/media/parsers/aac-config-parser";

describe("parseAACConfig", () => {
  it("throw if codecData length is less than 2", () => {
    expect(() => parseAACConfig([])).toThrowError(
      "ASC parsing error. codecData too small",
    );
    expect(() => parseAACConfig([0x12])).toThrowError(
      "ASC parsing error. codecData too small",
    );
  });

  it("basic config 44100, 1024, 2", () => {
    const codecData = new Uint8Array([0x12, 0x10]); // audioObjectType = 2, freqIndex = 4 (44100Hz), channels = 2
    const config = parseAACConfig(codecData);
    expect(config).toEqual({
      audioObjectType: 2,
      sampleRate: 44100,
      numberOfChannels: 2,
      sampleCount: 1024,
    });
  });

  it("config with audioObjectType = 31 (escape code)", () => {
    // objectType = 31 => 0xF8 (11111000), next byte: freqIndex = 4
    const codecData = new Uint8Array([0xf8, 0x08, 0x80]); // 31, freqIndex = 4 (44100Hz), channels = 4
    const config = parseAACConfig(codecData);
    expect(config).toEqual({
      audioObjectType: 31,
      sampleRate: 44100,
      numberOfChannels: 4,
      sampleCount: 1024,
    });
  });

  it("config with freqIndex = 15 (explicit frequency) and audioObjectType != 31", () => {
    const sampleRate = 44100;
    const codecData = new Uint8Array([
      0x0f, // 00001111 => objectType = 1 (00001), freqIndex high bits
      0x88, // 10001000 => freqIndex low + sampleRate
      0x00, // sampleRate
      0x80, // sampleRate
      0x78, // channel = (0x78 & 0x78) >> 3 = 15, sampleCount = 1024
    ]);

    const config = parseAACConfig(codecData);
    expect(config).toEqual({
      audioObjectType: 1,
      sampleRate: 1048832,
      numberOfChannels: 15,
      sampleCount: 1024,
    });
  });

  it("config with freqIndex = 15 (explicit frequency) and audioObjectType = 31", () => {
    const codecData = new Uint8Array([0xff, 0xfe, 0x00, 0x80, 0x70, 0xf0]);
    const config = parseAACConfig(codecData);
    expect(config).toEqual({
      audioObjectType: 31,
      sampleRate: 16440,
      numberOfChannels: 8,
      sampleCount: 960,
    });
  });

  it("config with freqIndex = 0 and audioObjectType = 31", () => {
    const codecData = new Uint8Array([0xf8, 0x81, 0x70, 0x80, 0x70, 0xa0]);
    const config = parseAACConfig(codecData);
    expect(config).toEqual({
      audioObjectType: 31,
      sampleRate: 96000,
      numberOfChannels: 11,
      sampleCount: 960,
    });
  });

  it("multiple frequency indices", () => {
    const freqs = [
      96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000,
      11025, 8000, 7350,
    ];

    freqs.forEach((rate, i) => {
      const objectType = 2;
      const freqIndex = i;

      const byte1 = (objectType << 3) | ((freqIndex & 0x0e) >> 1);
      const byte2 = ((freqIndex & 0x01) << 7) | (2 << 3); // channels = 2 (0b10)

      const config = parseAACConfig(new Uint8Array([byte1, byte2]));
      expect(config).toEqual({
        audioObjectType: 2,
        sampleRate: rate,
        numberOfChannels: 2,
        sampleCount: 1024,
      });
    });
  });
});

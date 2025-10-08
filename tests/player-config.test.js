import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockLogger } from "./mocks/logger-mock";
import { LoggersFactory } from "@/shared/logger";
import { createConfig } from "@/player-config";

describe("createConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws if required config keys are missing", () => {
    expect(() => createConfig({})).toThrow(
      'Config key "streamUrl" is required',
    );
    expect(() => createConfig({ streamUrl: "x" })).toThrow(
      'Config key "container" is required',
    );
  });

  it("merges defaults and calculates fullBufferMs", () => {
    const config = createConfig({
      streamUrl: "wss://localhost/app/stream",
      container: {},
    });

    expect(config.streamUrl).toBe("wss://localhost/app/stream");
    expect(config.container).toEqual({});
    expect(config.autoplay).toBe(false);
    expect(config.width).toBe(476);
    expect(config.height).toBe(268);
    expect(config.fullBufferMs).toBe(200 + 1000 + 3000);
  });

  it("filters unknown keys and logs a warning", () => {
    createConfig({
      streamUrl: "x",
      container: {},
      wrong: "err",
      anotherWrong: 123,
    });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Config key "wrong" is unknown',
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Config key "anotherWrong" is unknown',
    );
  });

  it("sets log level via LoggersFactory", () => {
    createConfig({
      streamUrl: "wss://localhost/app/stream",
      container: {},
      logLevel: "debug",
    });

    expect(LoggersFactory.setLevel).toHaveBeenCalledWith("debug");
  });

  it("calls LoggersFactory.create with instance name", () => {
    createConfig({
      streamUrl: "wss://localhost/app/stream",
      container: {},
      instanceName: "testPlayer",
    });

    expect(LoggersFactory.create).toHaveBeenCalledWith(
      "testPlayer",
      "Player config",
    );
  });

  it("proxy get warns when unknown key is accessed", () => {
    const config = createConfig({
      streamUrl: "wss://localhost/app/stream",
      container: {},
    });

    const unknownKey = config.nonExistent;
    expect(unknownKey).toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Config get unknown key "nonExistent"',
    );
  });

  it("returns false and warns when unknown key is assigned", () => {
    const config = createConfig({
      streamUrl: "wss://localhost/app/stream",
      container: {},
    });

    expect(() => {
      config.nonValidKey = 123;
    }).toThrow(TypeError);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Config set unknown key "nonValidKey"',
    );
  });

  it("returns true and updates known keys", () => {
    const config = createConfig({
      streamUrl: "wss://localhost/app/stream",
      container: {},
    });

    const result = (config.autoplay = true);
    expect(result).toBe(true);
    expect(config.autoplay).toBe(true);
  });
});

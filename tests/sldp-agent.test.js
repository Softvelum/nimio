import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SLDPAgent } from "@/sldp/agent";

describe("SLDPAgent session tagging", () => {
  let post;

  beforeEach(() => {
    post = vi.fn();
    vi.stubGlobal("self", { postMessage: post });
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("tags a status with the session it was started with", () => {
    const agent = new SLDPAgent();
    agent.session = 3;
    const status = { info: [{ stream: "s", stream_info: { vcodec: "avc1" } }] };

    agent.processStatus(JSON.stringify(status));

    expect(post).toHaveBeenCalledWith({
      type: "status",
      data: status,
      session: 3,
    });
  });

  it("tags an invalid-status error with the session", () => {
    const agent = new SLDPAgent();
    agent.session = 4;

    agent.processStatus(JSON.stringify({ info: [] }));

    expect(post).toHaveBeenCalledWith({ type: "error", session: 4 });
  });
});

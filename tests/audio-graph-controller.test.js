import { describe, it, expect, vi } from "vitest";
import { AudioGraphController } from "@/audio/graph-controller";

function fakeNode() {
  return { connect: vi.fn(), disconnect: vi.fn(), context: {} };
}

describe("AudioGraphController.destroy()", () => {
  it("disconnects the graph and forgets the source and nodes", () => {
    const ctrl = AudioGraphController.getInstance("agc-destroy");
    const src = fakeNode();
    const gain = fakeNode();
    ctrl.setSource(src);
    ctrl.appendNode(gain, { connectPrev: true });
    expect(src.connect).toHaveBeenCalledWith(gain);

    ctrl.destroy();

    expect(src.disconnect).toHaveBeenCalledWith(gain);
    expect(ctrl.canAcceptNode(src)).toBe(false);
    expect(ctrl.appendNode(fakeNode(), { connectPrev: true })).toBe(0);
  });
});

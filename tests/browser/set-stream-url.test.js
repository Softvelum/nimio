import { describe, it, expect, afterEach } from "vitest";
import Nimio from "@/nimio";

// Reproduces https://github.com/Softvelum/nimio/issues/94:
// setStreamURL() throws on a live player.

const URL_A = "wss://127.0.0.1:1/live/stream-a";
const URL_B = "wss://127.0.0.1:1/live/stream-b";

let instCounter = 0;
const players = [];
const containers = [];

function createPlayer() {
  const container = document.createElement("div");
  container.style.cssText = "width:640px;height:360px";
  document.body.appendChild(container);
  containers.push(container);

  const player = new Nimio({
    instanceName: `set-url-${++instCounter}`,
    container,
    streamUrl: URL_A,
  });
  players.push(player);
  return player;
}

// Records commands the live player sends to its transport worker
function recordTransport(player) {
  const sent = [];
  const transport = player._livePlayer._transport;
  const send = transport.send.bind(transport);
  transport.send = (cmd, data) => {
    sent.push({ cmd, ...data });
    return send(cmd, data);
  };
  return sent;
}

function starts(sent) {
  return sent.filter((m) => m.cmd === "start").map((m) => m.url);
}

describe("Nimio.setStreamURL() on a live player (#94)", () => {
  afterEach(() => {
    for (const p of players.splice(0)) p.destroy();
    for (const c of containers.splice(0)) c.remove();
  });

  it("reconnects a playing player to the new URL", () => {
    const player = createPlayer();
    const sent = recordTransport(player);
    player.play();

    expect(() => player.setStreamURL(URL_B)).not.toThrow();

    expect(starts(sent)).toEqual([URL_A, URL_B]);
    const closeIdx = sent.findIndex((m) => m.cmd === "stop" && m.close);
    const startIdx = sent.findLastIndex((m) => m.cmd === "start");
    expect(closeIdx).toBeGreaterThan(-1);
    expect(closeIdx).toBeLessThan(startIdx);
  });

  it("uses the new URL on the next play() of a stopped player", () => {
    const player = createPlayer();
    const sent = recordTransport(player);

    player.setStreamURL(URL_B);
    expect(starts(sent)).toEqual([]);

    player.play();
    expect(starts(sent)).toEqual([URL_B]);
  });

  it("keeps a paused player paused and uses the new URL on play()", () => {
    const player = createPlayer();
    const sent = recordTransport(player);
    player.play();
    player.pause();

    player.setStreamURL(URL_B);
    expect(starts(sent)).toEqual([URL_A]);

    player.play();
    expect(starts(sent)).toEqual([URL_A, URL_B]);
  });

  it("closes the connection on every switch, even while connecting", () => {
    const player = createPlayer();
    const sent = recordTransport(player);
    player.play();

    player.setStreamURL(URL_B);
    player.setStreamURL(URL_A);

    const closes = sent.filter((m) => m.cmd === "stop" && m.close).length;
    expect(starts(sent)).toEqual([URL_A, URL_B, URL_A]);
    expect(closes).toBe(2);
  });
});

import { SLDPAgent } from "./sldp/agent";

export function createProtocolAgent(protocol) {
  switch (protocol) {
    case "sldp.softvelum.com":
      return new SLDPAgent();
    default:
      throw new Error("Unknown protocol: " + protocol);
  }
}

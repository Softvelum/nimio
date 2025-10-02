import { multiInstanceService } from "@/shared/service";
import { AudioContextProvider } from "./context-provider";
import LoggersFactory from "@/shared/logger";

class AudioGraphController {
  constructor(instName) {
    this._instName = instName;
    this._logger = LoggersFactory.create(instName, "AudioGraphController");
    this._audCtxProvider = AudioContextProvider.getInstance(instName);
    this._nodes = [];
  }

  setSource(src) {
    if (this._source && this._nodes.length > 0) {
      this._source.disconnect(this._nodes[0]);
    }
    this._source = src;
    if (this._nodes.length > 0) {
      this._source.connect(this._nodes[0]);
    }
  }

  appendNode(node) {
    const nodeLen = this._nodes.length;
    let prevNode = nodeLen > 0 ? this._nodes[nodeLen - 1] : this._source;
    if (prevNode) {
      prevNode.connect(node);
      this._nodes.push(node);
    }
  }
}

AudioGraphController = multiInstanceService(AudioGraphController);
export { AudioGraphController };

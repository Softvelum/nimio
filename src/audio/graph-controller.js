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

  assemble(...conns) {
    this._audCtx = this._audCtxProvider.get();
    for (let i = 0; i < conns.length; i++) {
      let s = this._getSource(conns[i][0]);
      let d = this._getDestination(conns[i][1]);
      if (!s || !d) {
        this._logger.error(`Can't connect nodes ${conns[i][0]}->${conns[i][1]}`);
        return false;
      }
    }

    this.reset();
    for (let i = 0; i < conns.length; i++) {
      let s = this._getSource(conns[i][0]);
      let d = this._getDestination(conns[i][1]);
      this._connect(s, d);
    }

    return true;
  }

  reset() {
    if (this._source) {
      if (this._source._outconns) {
        for (let i = 0; i < this._source._outconns.length; i++) {
          this._source.disconnect(this._source._outconns[i]);
        }
      }
      this._source._outconns = [];
    }
    for (let i = 0; i < this._nodes.length; i++) {
      this._nodes[i]._inconns = [];
      for (let j = 0; j < this._nodes[i]._outconns.length; i++) {
        this._nodes[i].disconnect(this._nodes[i]._outconns[j]);
      }
      this._nodes._outconns = [];
    }
    this._audCtx.destination._inconns = [];
  }

  setSource(src) {
    let srcConns = [];
    if (this._source?._outconns) {
      for (let i = 0; i < this._source._outconns.length; i++) {
        this._source.disconnect(this._source._outconns[i]);
      }
      srcConns = this._source._outconns;
      this._source._outconns = [];
    }

    let oldSrc = this._source;
    this._source = src;
    this._source._outconns = [];

    for (let i = 0; i < srcConns.length; i++) {
      this._source.connect(srcConns[i]);
      this._source._outconns.push(srcConns[i]);
      let idx = srcConns[i]._inconns.indexOf(oldSrc);
      if (idx >= 0) {
        srcConns[i]._inconns[idx] = this._source;
      }
    }
  }

  appendNode(node, skipConnect = false) {
    let nLen = this._nodes.length;
    let prevNode = nLen > 0 ? this._nodes[nLen - 1] : this._source;

    this._nodes.push(node);
    node._inconns = [];
    node._outconns = [];

    if (!prevNode || skipConnect) return;

    let outConns = prevNode._outconns;
    for (let i = 0; i < outConns.length; i++) {
      prevNode.disconnect(outConns[i]);
      node.connect(outConns[i]);
      node._outconns.push(outConns[i]);
      let idx = outConns[i]._inconns.indexOf(prevNode);
      if (idx >= 0) {
        outConns[i]._inconns[idx] = node;
      }
    }
    prevNode._outconns.length = 0;
    this._connect(prevNode, node);
  }

  prependNode(node, skipConnect = false) {
    this._audCtx = this._audCtxProvider.get();
    let nLen = this._nodes.length;
    let nextNode = nLen > 0 ? this._nodes[0] : this._audCtx.destination;

    this._nodes.shift(node);
    node._inconns = [];
    node._outconns = [];

    if (!nextNode || skipConnect) return;

    let inConns = prevNode._inconns;
    for (let i = 0; i < inConns.length; i++) {
      inConns[i].disconnect(nextNode);
      inConns[i].connect(node);
      node._inconns.push(inConns[i]);
      let idx = inConns[i]._outconns.indexOf(nextNode);
      if (idx >= 0) {
        inConns[i]._outconns[idx] = node;
      }
    }
    nextNode._inconns.length = 0;
    this._connect(node, nextNode);
  }

  removeNode(node) {
    for (let i = 0; i < this._nodes.length; i++) {
      if (this._nodes[i] === node) {
        let ss = this._nodes[i]._inconns;
        let os = this._nodes[i]._outconns;
        for (let j = 0; j < ss.length; j++) {
          ss[j].disconnect(this._nodes[i]);
          let dIdx = ss[j]._outconns.indexOf(this._nodes[i]);
          if (dIdx >= 0) ss[j]._outconns.splice(dIdx, 1);
        }
        for (let j = 0; j < os.length; j++) {
          this._nodes[i].disconnect(os[j]);
          let sIdx = os[j]._inconns.indexOf(this._nodes[i]);
          if (sIdx >= 0) os[j]._inconns.splice(sIdx, 1);
        }
        for (let j = 0; j < ss.length; j++) {
          for (let k = 0; k < os.length; k++) {
            if (os[k]._inconns.indexOf(ss[j]) === -1) {
              this._connect(ss[j], os[k]);
            }
          }
        }
      }
    }
  }

  _getSource(s) {
    return s === 'src' ? this._source : this._nodes[parseInt(s)];
  }
  _getDestination(d) {
    return d === 'dst' ? this._audCtx.destination : this._nodes[parseInt(d)];
  }
  _connect(s, d) {
    s.connect(d);
    s._outconns.push(d);
    d._inconns.push(s);
  }
  _breakConn(s, d) {
    s.disconnect(d);
    let dIdx = s._outconns.indexOf(d);
    if (dIdx >= 0) s._outconns.splice(dIdx, 1);
    let sIdx = d._inconns.indexOf(s);
    if (sIdx >= 0) d._inconns.splice(sIdx, 1);
  }
}

AudioGraphController = multiInstanceService(AudioGraphController);
export { AudioGraphController };

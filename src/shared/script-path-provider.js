import { multiInstanceService } from "./service";

class ScriptPathProvider {
  constructor(instName) {
    this._instName = instName;
  }

  setScriptPath(path) {
    this._scriptPath = path;
  }

  translateToScriptPath(url) {
    if (this._scriptPath) {
      return this._scriptPath + this._extractFilenameFrom(url);
    }

    return url;
  }

  // runWebpackImportUnderScriptPath (method) {
  //   let oldWebpackPublicPath = __webpack_public_path__;
  //   __webpack_public_path__ = this._scriptPath;
  //   method();
  //   __webpack_public_path__ = oldWebpackPublicPath;
  // }

  notAvailableError(name, url) {
    let file = this._extractFilenameFrom(url);
    return (
      `${name} file is not found. It should be placed in the same path as Nimio Player itself. ` +
      `Please download it from the following path: https://softvelum.com/nimio/releases/${file}`
    );
  }

  _extractFilenameFrom(url) {
    if (url && url.length > 0) {
      return url.substr(url.lastIndexOf("/") + 1);
    }

    return url;
  }
}

ScriptPathProvider = multiInstanceService(ScriptPathProvider);
export { ScriptPathProvider };

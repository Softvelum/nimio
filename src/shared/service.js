export function singleInstanceService(Klass) {
  let instance;
  return {
    getInstance: function () {
      if (!instance) {
        instance = new Klass();
        instance.constructor = null;
      }
      return instance;
    },
  };
}

const multiInstanceServices = [];

export function multiInstanceService(Klass) {
  let instances = {};
  const service = {
    getInstance: function (instanceId) {
      if (!instanceId) {
        console.error("multiInstance getInstance is called without instanceId");
        return null;
      }
      if (!instances[instanceId]) {
        instances[instanceId] = new Klass(instanceId);
        instances[instanceId].constructor = null;
      }

      return instances[instanceId];
    },
    release: function (instanceId) {
      const instance = instances[instanceId];
      if (!instance) return;

      delete instances[instanceId];
      if (typeof instance.destroy === "function") instance.destroy();
    },
  };
  multiInstanceServices.push(service);
  return service;
}

// Drops the instance from every per-instance service, calling destroy() on
// the ones that hold resources
export function releaseInstances(instanceId) {
  // one service's destroy() must not keep the others registered; the first
  // error is rethrown once every service has been released
  let firstError;
  for (let i = 0; i < multiInstanceServices.length; i++) {
    try {
      multiInstanceServices[i].release(instanceId);
    } catch (err) {
      if (firstError === undefined) firstError = err;
    }
  }
  if (firstError !== undefined) throw firstError;
}

const usedInstanceKeys = new Set();

// Each player gets its own registry key, so services a destroyed player
// recreates from a late callback never reach a new player with the same name
export function allocateInstanceKey(name) {
  let key = name;
  for (let n = 2; usedInstanceKeys.has(key); n++) {
    key = `${name}#${n}`;
  }
  usedInstanceKeys.add(key);
  return key;
}

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

export function multiInstanceService(Klass) {
  let instances = {};
  return {
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
  };
}

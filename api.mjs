export default {
  getState: async ({ homey }) => {
    return homey.app.onAPIGetState();
  },
  getDevices: async ({ homey }) => {
    return homey.app.onAPIGetDevices();
  },
  enableDevice: async ({ homey, body }) => {
    return homey.app.onAPIEnableDevice({ deviceId: body.deviceId });
  },
  disableDevice: async ({ homey, body }) => {
    return homey.app.onAPIDisableDevice({ deviceId: body.deviceId });
  },
  getFlows: async ({ homey }) => {
    return homey.app.onAPIGetFlows();
  },
  enableFlow: async ({ homey, body }) => {
    return homey.app.onAPIEnableFlow({ flowId: body.flowId });
  },
  disableFlow: async ({ homey, body }) => {
    return homey.app.onAPIDisableFlow({ flowId: body.flowId });
  }
};

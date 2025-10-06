export default {
  getDevices: async ({ homey }) => {
    return homey.app.onAPIGetDevices();
  },
  enableDevice: async ({ homey, body }) => {
    return homey.app.onAPIEnableDevice({ deviceId: body.deviceId });
  },
  disableDevice: async ({ homey, body }) => {
    return homey.app.onAPIDisableDevice({ deviceId: body.deviceId });
  }
};
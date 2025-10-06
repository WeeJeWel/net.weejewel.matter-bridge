import Homey from 'homey';
import { HomeyAPI } from 'homey-api';
import MatterBridgeServer from './MatterBridgeServer.mjs'

export default class MatterBridgeApp extends Homey.App {

  async onInit() {
    this.log('Starting Matter Bridge Server...');

    this.api = await HomeyAPI.createAppAPI({
      homey: this.homey,
      debug: (...props) => this.log(`[HomeyAPI]`, ...props),
    });

    await this.api.drivers.connect();
    await this.api.drivers.getDrivers();

    await this.api.devices.connect();
    await this.api.devices.getDevices();

    this.server = new MatterBridgeServer({
      api: this.api,
      debug: (...props) => this.log(`[MatterBridgeServer]`, ...props),
      uniqueId: 'homey',
      serialNumber: 'homey',
      enabledDeviceIds: await this.getEnabledDeviceIds(),
    });
    await this.server.start();
  }

  async getEnabledDeviceIds() {
    return new Set(await this.homey.settings.get('enabledDeviceIds') || []);
  }

  async onAPIGetDevices() {
    const devices = await this.api.devices.getDevices();
    return Object.values(devices).map(device => ({
      id: device.id,
      name: device.name,
      selected: this.server?.enabledDeviceIds.has(device.id) ?? false,
    }));
  }

  async onAPIEnableDevice({ deviceId }) {
    const enabledDeviceIds = await this.getEnabledDeviceIds();
    if (!enabledDeviceIds.has(deviceId)) {
      enabledDeviceIds.add(deviceId);
      await this.homey.settings.set('enabledDeviceIds', Array.from(enabledDeviceIds));
      await this.server.enableDevice(deviceId);
    }
  }

  async onAPIDisableDevice({ deviceId }) {
    const enabledDeviceIds = await this.getEnabledDeviceIds();
    if (enabledDeviceIds.has(deviceId)) {
      enabledDeviceIds.delete(deviceId);
      await this.homey.settings.set('enabledDeviceIds', Array.from(enabledDeviceIds));
      await this.server.disableDevice(deviceId);
    }
  }

}

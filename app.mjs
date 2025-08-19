import Homey from 'homey';
import MatterServer from './lib/MatterServer.mjs'

export default class MatterBridgeApp extends Homey.App {

  async onInit() {
    this.log('Starting Matter Server...');

    this.server = new MatterServer();
    await this.server.start({
      uniqueId: 'abcdef', // await this.homey.cloud.getHomeyId(),
    });
  }

}
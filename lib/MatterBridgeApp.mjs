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

    this.server = new MatterBridgeServer({
      api: this.api,
      debug: (...props) => this.log(`[MatterBridgeServer]`, ...props),
    });
    await this.server.start({
      uniqueId: 'abcdef', // await this.homey.cloud.getHomeyId() too long,
    });
  }

}
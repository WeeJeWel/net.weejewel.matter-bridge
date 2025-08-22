import { HomeyAPI } from 'homey-api';
import MatterBridgeServer from './lib/MatterBridgeServer.mjs';

const api = await HomeyAPI.createLocalAPI({
  address: process.env.HOMEY_ADDRESS,
  token: process.env.HOMEY_TOKEN,
  debug: (...props) => console.log(`[HomeyAPI]`, ...props),
});

const server = new MatterBridgeServer({
  api,
  debug: (...props) => console.log(`[MatterBridgeServer]`, ...props),
  storageServiceLocation: './.matter/',
});
await server.start({
  uniqueId: 'standalone',
});
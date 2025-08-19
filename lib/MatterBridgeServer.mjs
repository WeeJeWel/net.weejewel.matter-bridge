import { Endpoint, Environment, StorageService, ServerNode, VendorId } from "@matter/main";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors/bridged-device-basic-information";
import { OnOffLightDevice } from "@matter/main/devices/on-off-light";
import { OnOffPlugInUnitDevice } from "@matter/main/devices/on-off-plug-in-unit";
import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";

export default class MatterBridgeServer {

  async start({
    isSocket = [false, false],
    deviceName = 'Homey Matter Bridge',
    vendorName = 'Athom B.V.',
    passcode = 20202021,
    discriminator = 3840,
    vendorId = 65521,
    productName = 'Homey Matter Bridge',
    productId = 32768,
    port = 5540,
    uniqueId = null,
  }) {
    // Set storage to /userdata/
    this.environment = Environment.default;

    this.storageService = this.environment.get(StorageService);
    this.storageService.location = '/userdata/';

    this.server = await ServerNode.create({
      id: uniqueId,
      network: { port },
      commissioning: { passcode, discriminator },
      productDescription: {
        name: deviceName,
        deviceType: AggregatorEndpoint.deviceType,
      },
      basicInformation: {
        vendorName,
        vendorId: VendorId(vendorId),
        nodeLabel: productName,
        productName,
        productLabel: productName,
        productId,
        serialNumber: `matterjs-${uniqueId}`,
        uniqueId,
      },
    });

    const aggregator = new Endpoint(AggregatorEndpoint, { id: "aggregator" });
    await this.server.add(aggregator);

    for (let idx = 0; idx < isSocket.length; idx++) {
      const i = idx + 1;
      const isASocket = isSocket[idx];
      const name = `OnOff ${isASocket ? "Socket" : "Light"} ${i}`;

      const endpoint = new Endpoint(
        isASocket
          ? OnOffPlugInUnitDevice.with(BridgedDeviceBasicInformationServer)
          : OnOffLightDevice.with(BridgedDeviceBasicInformationServer),
        {
          id: `onoff-${i}`,
          bridgedDeviceBasicInformation: {
            nodeLabel: name,
            productName: name,
            productLabel: name,
            serialNumber: `node-matter-${uniqueId}-${i}`,
            reachable: true,
          },
        },
      );
      await aggregator.add(endpoint);

      endpoint.events.identify.startIdentifying.on(() => {
        console.log(`Run identify logic for ${name}, ideally blink a light every 0.5s ...`);
      });

      endpoint.events.identify.stopIdentifying.on(() => {
        console.log(`Stop identify logic for ${name} ...`);
      });

      endpoint.events.onOff.onOff$Changed.on(value => {
        console.log(`${name} is now ${value ? "ON" : "OFF"}`);
      });
    }

    await this.server.start();
  }

}
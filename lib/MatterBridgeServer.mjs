import { Endpoint, Environment, StorageService, ServerNode, VendorId } from "@matter/main";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors/bridged-device-basic-information";
import { OnOffLightDevice } from "@matter/main/devices/on-off-light";
import { OnOffPlugInUnitDevice } from "@matter/main/devices/on-off-plug-in-unit";
import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";

export default class MatterBridgeServer {

  constructor({
    api,
    debug,
  }) {
    this.api = api;
    this.debug = debug;

    // Set storage to /userdata/
    this.environment = Environment.default;

    this.storageService = this.environment.get(StorageService);
    this.storageService.location = '/userdata';
  }

  async start({
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

    await this.api.devices.connect();
    this.devices = await this.api.devices.getDevices();

    for (const [deviceId, device] of Object.entries(this.devices)) {
      const deviceClass = device.virtualClass ?? device.class;
      if (deviceClass !== 'light') continue;

      try {
        const endpoint = new Endpoint(
          OnOffLightDevice.with(BridgedDeviceBasicInformationServer),
          // isASocket
          //   ? OnOffPlugInUnitDevice.with(BridgedDeviceBasicInformationServer)
          //   : OnOffLightDevice.with(BridgedDeviceBasicInformationServer),
          {
            id: deviceId,
            bridgedDeviceBasicInformation: {
              nodeLabel: device.name,
              productName: device.name,
              productLabel: device.name,
              serialNumber: '-',
              reachable: true,
            },
          },
        );

        endpoint.events.identify.startIdentifying.on(() => {
          console.log(`Run identify logic for ${name}, ideally blink a light every 0.5s ...`);
        });

        endpoint.events.identify.stopIdentifying.on(() => {
          console.log(`Stop identify logic for ${name} ...`);
        });

        endpoint.events.onOff.onOff$Changed.on(async value => {
          console.log(value)
          await this.api.devices.setCapabilityValue({
            deviceId,
            capabilityId: 'onoff',
            value,
          });
        });

        await aggregator.add(endpoint);
        this.debug(`✅ Added device ${deviceId} (${device.name})`);
      } catch (err) {
        this.debug(`❌ Error initializing device ${deviceId} (${device.name}):`, err);
      }
    }

    await this.server.start();
  }

}
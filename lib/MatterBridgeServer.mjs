import { Endpoint, Environment, StorageService, ServerNode, VendorId } from "@matter/main";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors/bridged-device-basic-information";

// Socket
import { OnOffPlugInUnitDevice } from "@matter/main/devices/on-off-plug-in-unit";

// Light
import { OnOffLightDevice } from "@matter/main/devices/on-off-light";
import { ColorTemperatureLightDevice } from "@matter/main/devices/color-temperature-light";
import { ExtendedColorLightDevice } from "@matter/main/devices/extended-color-light";
import { DimmableLightDevice } from "@matter/main/devices/dimmable-light";
import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";

export default class MatterBridgeServer {

  constructor({
    api,
    debug,
    storageServiceLocation = '/userdata',
  }) {
    this.api = api;
    this.debug = debug;

    // Set storage location
    this.environment = Environment.default;

    this.storageService = this.environment.get(StorageService);
    this.storageService.location = storageServiceLocation;
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
    // Create the Server
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

    // Create an Aggregator Endpoint
    this.serverAggregator = new Endpoint(AggregatorEndpoint, { id: "aggregator" });
    await this.server.add(this.serverAggregator);

    // Start the Server
    await this.server.start();

    // Get all Homey Devices
    await this.api.devices.connect();
    this.devices = await this.api.devices.getDevices();

    // Loop all Homey Devices
    await Promise.all(Object.entries(this.devices).map(async ([deviceId, device]) => {
      const deviceClass = device.virtualClass ?? device.class;
      if (deviceClass !== 'light') return;

      let matterDevice;
      let matterObject;

      switch (deviceClass) {
        case 'light': {
          if (false) {
            // } else if (device.capabilities.includes('onoff')
            //   && device.capabilities.includes('dim')
            //   && device.capabilities.includes('light_hue')
            //   && device.capabilities.includes('light_saturation')
            //   && device.capabilities.includes('light_temperature')
            // ) {
            //   matterDevice = ColorTemperatureLightDevice;
            //   matterObject = {
            //     onOff: {
            //       onOff: device.capabilitiesObj?.onoff?.value ?? null,
            //     },
            //     levelControl: {
            //       level: Math.floor(device.capabilitiesObj?.dim?.value * 255) ?? null,
            //     },
            //     colorControl: {
            //       //
            //     },
            //   };
            // } else if (device.capabilities.includes('onoff')
            //   && device.capabilities.includes('dim')
            //   && device.capabilities.includes('light_hue')
            //   && device.capabilities.includes('light_saturation')
            // ) {
            //   matterDevice = ExtendedColorLightDevice;
            //   matterObject = {
            //     onOff: {
            //       onOff: device.capabilitiesObj?.onoff?.value ?? null,
            //     },
            //     levelControl: {
            //       level: Math.floor(device.capabilitiesObj?.dim?.value * 255) ?? null,
            //     },
            //     colorControl: {
            //       hue: Math.floor((device.capabilitiesObj?.light_hue?.value ?? 0) * 360) ?? null,
            //       saturation: Math.floor((device.capabilitiesObj?.light_saturation?.value ?? 0) * 100) ?? null,
            //     },
            //   };
          } else if (device.capabilities.includes('onoff')
            && device.capabilities.includes('dim')
          ) {
            matterDevice = DimmableLightDevice;
            matterObject = {
              onOff: {
                onOff: device.capabilitiesObj?.onoff?.value ?? null,
              },
              levelControl: {
                value: device.capabilitiesObj?.dim?.value ?? null,
              },
            };
          } else if (device.capabilities.includes('onoff')) {
            matterDevice = OnOffLightDevice;
            matterObject = {
              onOff: {
                onOff: device.capabilitiesObj?.onoff?.value ?? null,
              },
            };
          }
          else {
            return;
          }
          break;
        }
        // case 'sensor': {
        //   matterDevice = SensorDevice;
        //   matterObject = {
        //     // TODO
        //   };
        // }
        // case 'socket':
        //   matterDevice = OnOffPlugInUnitDevice;
        //   matterObject = BridgedDeviceBasicInformationServer;
        //   break;
        default:
          return;
      }

      try {
        const endpoint = new Endpoint(matterDevice.with(BridgedDeviceBasicInformationServer), {
          id: deviceId,
          bridgedDeviceBasicInformation: {
            nodeLabel: device.name,
            productName: device.name,
            productLabel: device.name,
            serialNumber: '-',
            reachable: true,
          },
          ...matterObject,
        });

        // Connect to the Device
        await device.connect();
        device.on('update', () => {
          // TODO
        });
        device.on('delete', () => {
          // TODO
        });
        device.on('capability', ({ capabilityId, value }) => {
          console.log(`Capability ${capabilityId} changed to ${value}`);

          const newEndpointObj = {};

          if (capabilityId === 'onoff') {
            newEndpointObj.onOff = {
              onOff: value,
            };
          }

          this.debug('newEndpointObj', newEndpointObj);
          if (Object.keys(newEndpointObj).length > 0) {
            endpoint.set(newEndpointObj).catch(err => {
              this.debug(`[Device:${deviceId}] Error Setting ${capabilityId} to ${value}: ${err.message}`);
            });
          }
        });

        endpoint.events.onOff.onOff$Changed.on(async value => {
          this.debug(`[Device:${deviceId}] onOff changed to ${value}`);
          await this.api.devices.setCapabilityValue({
            deviceId,
            capabilityId: 'onoff',
            value,
          });
        });

        await this.serverAggregator.add(endpoint);
        this.debug(`✅ Added device ${deviceId} (${device.name})`);
      } catch (err) {
        this.debug(`❌ Error initializing device ${deviceId} (${device.name}):`, err);
      }
    }));
  }

}
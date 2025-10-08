import { Endpoint, Environment, StorageService, ServerNode, VendorId } from '@matter/main';
import { BridgedNodeEndpoint } from '@matter/main/endpoints/bridged-node';
import { BridgedDeviceBasicInformationServer } from '@matter/main/behaviors/bridged-device-basic-information';
import { FixedLabelServer } from '@matter/main/behaviors/fixed-label';

// import { ElectricalSensorEndpoint, ElectricalSensorRequirements } from '@matter/main/endpoints/electrical-sensor';
import {
  ElectricalPowerMeasurement,
  ConcentrationMeasurement,
  Thermostat,
  ColorControl,
  SmokeCoAlarm,
  OccupancySensing,
} from '@matter/main/clusters';
import {
  AggregatorEndpoint,
} from '@matter/main/endpoints';
import {
  OnOffPlugInUnitDevice,
  OnOffLightDevice,
  DimmableLightDevice,
  ColorTemperatureLightDevice,
  ExtendedColorLightDevice,
  TemperatureSensorDevice,
  HumiditySensorDevice,
  ThermostatDevice,
  SmokeCoAlarmDevice,
  AirQualitySensorDevice,
  OccupancySensorDevice,
} from '@matter/main/devices';
import {
  OnOffServer,
  LevelControlServer,
  ColorControlServer,
  TemperatureMeasurementServer,
  RelativeHumidityMeasurementServer,
  CarbonMonoxideConcentrationMeasurementServer,
  CarbonDioxideConcentrationMeasurementServer,
  Pm10ConcentrationMeasurementServer,
  Pm25ConcentrationMeasurementServer,
  OccupancySensingServer,
  SmokeCoAlarmServer,
  ElectricalPowerMeasurementServer,
  ThermostatServer,
} from '@matter/main/behaviors';
import {
  MeasurementType,
} from '@matter/main/types';

export default class MatterBridgeServer {

  constructor({
    api,
    debug,
    deviceName = 'Homey Matter Bridge',
    vendorName = 'Athom B.V.',
    passcode = 20202021,
    discriminator = 3840,
    vendorId = 65521,
    productName = 'Homey Matter Bridge',
    productId = 32768,
    port = 5540,
    serialNumber = null,
    uniqueId = null,
    storageServiceLocation = '/userdata',
    enabledDeviceIds = new Set(),
  }) {
    this.api = api;
    this.debug = debug;

    this.deviceName = deviceName;
    this.vendorName = vendorName;
    this.passcode = passcode;
    this.discriminator = discriminator;
    this.vendorId = vendorId;
    this.productName = productName;
    this.productId = productId;
    this.port = port;
    this.serialNumber = serialNumber;
    this.uniqueId = uniqueId;

    this.enabledDeviceIds = enabledDeviceIds;

    this.serverNode = null;
    this.aggregatorEndpoint = null;
    this.deviceEndpoints = {
      // [deviceId]: Endpoint
    };
    this.deviceCapabilityInstances = {
      // [deviceId]: {
      //   [capabilityId]: CapabilityInstance
      // }
    };

    // Set storage location
    this.environment = Environment.default;

    this.storageService = this.environment.get(StorageService);
    this.storageService.location = storageServiceLocation;
  }

  async getState() {
    return {
      commissioned: this.serverNode?.lifecycle?.isCommissioned ?? null,
      qrPairingCode: this.serverNode?.state?.commissioning?.pairingCodes?.qrPairingCode ?? null,
      manualPairingCode: this.serverNode?.state?.commissioning?.pairingCodes?.manualPairingCode ?? null,
    };
  }

  async start() {
    if (this.serverNode) {
      throw new Error('Already Started Server');
    }

    // Create the Server
    this.serverNode = await ServerNode.create({
      id: this.uniqueId,
      network: {
        port: this.port,
      },
      commissioning: {
        passcode: this.passcode,
        discriminator: this.discriminator,
      },
      productDescription: {
        name: this.deviceName,
        deviceType: AggregatorEndpoint.deviceType,
      },
      basicInformation: {
        vendorName: ellipseString(this.vendorName),
        vendorId: VendorId(this.vendorId),
        nodeLabel: ellipseString(this.productName),
        productName: ellipseString(this.productName),
        productLabel: ellipseString(this.productName),
        productId: this.productId,
        serialNumber: ellipseString(this.serialNumber),
        uniqueId: ellipseString(this.uniqueId),
      },
    });

    // Create an Aggregator Endpoint and start the Server
    this.aggregatorEndpoint = new Endpoint(AggregatorEndpoint.with(
      FixedLabelServer,
    ), {
      id: 'aggregator',
      fixedLabel: {
        labelList: [{
          label: 'name',
          value: 'Matter Bridge', // TODO: This does not work on Apple Home. It still shows 'Matter Accessory' after pairing.
        }],
      },
    });
    await this.serverNode.add(this.aggregatorEndpoint);
    await this.serverNode.start();

    // Get all Homey Devices
    await this.api.devices.connect();
    this.devices = await this.api.devices.getDevices();

    // Get all Homey Drivers
    await this.api.drivers.connect();
    this.drivers = await this.api.drivers.getDrivers();

    // Initialize all Homey Devices
    await this.__initDevices();
  }

  async enableDevice(deviceId) {
    if (this.enabledDeviceIds.has(deviceId)) return;

    const device = this.devices[deviceId];
    if (!device) {
      throw new Error(`Device with ID ${deviceId} not found`);
    }

    this.enabledDeviceIds.add(deviceId);
    await this.__initDevice(device);
  }

  async disableDevice(deviceId) {
    if (!this.enabledDeviceIds.has(deviceId)) return;

    const device = this.devices[deviceId];
    if (!device) {
      throw new Error(`Device with ID ${deviceId} not found`);
    }

    this.enabledDeviceIds.delete(deviceId);
    await this.__uninitDevice(device);
  }

  async __initDevices() {
    await Promise.all(Object.values(this.devices)
      .filter(device => {
        if (this.enabledDeviceIds.has(device.id)) return true;
        return false;
      })
      .map(async device => {
        await this.__initDevice(device);
      }));
  }

  async __initDevice(device) {
    this.debug(`Initializing ${device.name} (${device.id})`);

    // Calculate the device's class
    const deviceClass = device.virtualClass || device.class;

    // Get the device's driver
    const driver = this.drivers[device.driverId];

    // Create a Matter Endpoint
    const deviceEndpoint = this.deviceEndpoints[device.id] = new Endpoint(BridgedNodeEndpoint, {
      id: device.id,
      bridgedDeviceBasicInformation: {
        nodeLabel: ellipseString(device.name),
        vendorName: ellipseString(driver?.ownerName ?? 'Unknown'),
        productName: ellipseString(driver?.name ?? 'Unknown'),
        serialNumber: ellipseString(device.id.replaceAll('-', '')), // Max length is 32, so if we remove the dashes from the UUIDv4, it fits!
      },
    });
    await this.aggregatorEndpoint.add(deviceEndpoint);

    // Helper to create a Capability Instance, and store a reference to destroy it on uninitialization.
    const makeCapabilityInstance = (capabilityId, callback) => {
      this.deviceCapabilityInstances[device.id] = this.deviceCapabilityInstances[device.id] || {};
      if (this.deviceCapabilityInstances[device.id][capabilityId]) return;

      this.deviceCapabilityInstances[device.id][capabilityId] = device.makeCapabilityInstance(capabilityId, (...props) => {
        Promise.resolve().then(async () => {
          await callback(...props);
        }).catch(err => this.debug(`Error in capability instance callback for device ${device.id} capability ${capabilityId}: ${err.message}`));
      });
    }

    // Add Matter Behaviors based on the device class and capabilities
    switch (deviceClass) {
      case 'socket': {
        class HomeyOnOffServer extends OnOffServer {
          async on() {
            await device.setCapabilityValue({
              capabilityId: 'onoff',
              value: true,
            })
          }

          async off() {
            await device.setCapabilityValue({
              capabilityId: 'onoff',
              value: false,
            });
          }
        }

        const endpointServers = [];
        const endpointProperties = {
          id: 'main',
        };

        if (device.capabilitiesObj?.onoff) {
          endpointServers.push(HomeyOnOffServer);
          endpointProperties.onOff = {
            onOff: device.capabilitiesObj?.onoff?.value ?? false,
          };

          makeCapabilityInstance('onoff', async value => {
            await endpoint.set({
              onOff: {
                onOff: value,
              },
            });
          });
        }

        if (device.capabilitiesObj?.measure_power) {
          endpointServers.push(ElectricalPowerMeasurementServer);
          endpointProperties.electricalPowerMeasurement = {
            powerMode: ElectricalPowerMeasurement.PowerMode.Unknown,
            numberOfMeasurementTypes: 1,
            accuracy: [{
              measurementType: MeasurementType.ActivePower, // mW
              measured: true,
              minMeasuredValue: Number.MIN_SAFE_INTEGER,
              maxMeasuredValue: Number.MAX_SAFE_INTEGER,
              accuracyRanges: [
                {
                  rangeMin: Number.MIN_SAFE_INTEGER,
                  rangeMax: Number.MAX_SAFE_INTEGER,
                  fixedMax: 1,
                },
              ],
            }],
            activePower: device.capabilitiesObj?.measure_power?.value ?? false,
          };

          makeCapabilityInstance('measure_power', async value => {
            await endpoint.set({
              electricalPowerMeasurement: {
                activePower: value * 1000, // W to mW
              },
            });
          });
        }

        const endpoint = new Endpoint(OnOffPlugInUnitDevice.with(...endpointServers), endpointProperties);
        await deviceEndpoint.add(endpoint);

        break;
      }

      case 'light': {
        class HomeyOnOffServer extends OnOffServer {
          async on() {
            await device.setCapabilityValue({
              capabilityId: 'onoff',
              value: true,
            })
          }

          async off() {
            await device.setCapabilityValue({
              capabilityId: 'onoff',
              value: false,
            });
          }
        }

        class HomeyLevelControlServer extends LevelControlServer {
          async moveToLevelWithOnOff({
            level,
          }) {
            await Promise.all([
              device.capabilitiesObj.onoff && device.setCapabilityValue({
                capabilityId: 'onoff',
                value: level > 0,
              }),
              device.capabilitiesObj.dim && device.setCapabilityValue({
                capabilityId: 'dim',
                value: scaleNumber(level, 1, 254, 0, 1),
              }),
            ]);
          }

          async moveToLevel({
            level,
          }) {
            await device.setCapabilityValue({
              capabilityId: 'dim',
              value: scaleNumber(level, 1, 254, 0, 1),
            });
          }
        }

        class HomeyColorControlServer extends ColorControlServer {

          async moveToHueAndSaturation({
            hue,
            saturation,
          }) {
            await Promise.all([
              device.capabilitiesObj.onoff && device.setCapabilityValue({
                capabilityId: 'onoff',
                value: true,
              }),
              device.capabilitiesObj.light_hue && device.setCapabilityValue({
                capabilityId: 'light_hue',
                value: scaleNumber(hue, 0, 360, 0, 1),
              }),
              device.capabilitiesObj.light_saturation && device.setCapabilityValue({
                capabilityId: 'light_saturation',
                value: scaleNumber(saturation, 1, 254, 0, 1),
              }),
              device.capabilitiesObj.light_mode && device.setCapabilityValue({
                capabilityId: 'light_mode',
                value: 'color',
              }),
            ]);
          }

          async moveToColorTemperature({
            colorTemperatureMireds,
          }) {
            await Promise.all([
              device.capabilitiesObj.onoff && device.setCapabilityValue({
                capabilityId: 'onoff',
                value: true,
              }),
              device.capabilitiesObj.light_mode && device.setCapabilityValue({
                capabilityId: 'light_mode',
                value: 'temperature',
              }),
              device.capabilitiesObj.light_temperature && device.setCapabilityValue({
                capabilityId: 'light_temperature',
                value: scaleNumber(colorTemperatureMireds, 1, 1000, 0, 1),
              }),
              device.capabilitiesObj.light_mode && device.setCapabilityValue({
                capabilityId: 'light_mode',
                value: 'temperature',
              }),
            ]);
          }

        }

        let endpointClass = OnOffLightDevice;
        const endpointServers = [];
        const endpointProperties = {
          id: 'main',
        };

        if (device?.capabilitiesObj?.onoff) {
          endpointServers.push(HomeyOnOffServer);
          endpointProperties.onOff = {
            onOff: device.capabilitiesObj?.onoff?.value ?? false,
          };

          makeCapabilityInstance('onoff', async value => {
            await endpoint.set({
              onOff: {
                onOff: value ?? false,
              },
            });
          });
        }

        if (device?.capabilitiesObj?.dim) {
          endpointClass = DimmableLightDevice;
          endpointServers.push(HomeyLevelControlServer);
          endpointProperties.levelControl = {
            currentLevel: scaleNumber(device.capabilitiesObj?.dim?.value, 0, 1, 1, 254) ?? 1,
            minLevel: 1,
            maxLevel: 254,
          };

          makeCapabilityInstance('dim', async value => {
            await endpoint.set({
              levelControl: {
                currentLevel: scaleNumber(value, 0, 1, 1, 254) ?? 1,
              },
            });
          });
        }

        if (device?.capabilitiesObj?.light_hue && device?.capabilitiesObj?.light_saturation) {
          endpointClass = ExtendedColorLightDevice;
          endpointServers.push(HomeyColorControlServer.with(ColorControl.Feature.HueSaturation));
          endpointProperties.colorControl = {
            ...endpointProperties.colorControl,
            colorMode: ColorControl.ColorMode.CurrentHueAndCurrentSaturation,
            currentHue: scaleNumber(device.capabilitiesObj?.light_hue?.value, 0, 1, 0, 254) ?? 0,
            currentSaturation: scaleNumber(device.capabilitiesObj?.light_saturation?.value, 0, 1, 0, 254) ?? 0,
          };

          makeCapabilityInstance('light_hue', async value => {
            await endpoint.set({
              colorControl: {
                currentHue: scaleNumber(value, 0, 1, 0, 254) ?? 0,
              },
            });
          });

          makeCapabilityInstance('light_saturation', async value => {
            await endpoint.set({
              colorControl: {
                currentSaturation: scaleNumber(value, 0, 1, 0, 254) ?? 0,
              },
            });
          });
        }

        if (device?.capabilitiesObj?.light_temperature) {
          endpointClass = ColorTemperatureLightDevice;
          endpointProperties.colorControl = {
            ...endpointProperties.colorControl,
            colorMode: ColorControl.ColorMode.ColorTemperatureMireds,
            colorTempPhysicalMinMireds: 1,
            colorTempPhysicalMaxMireds: 1000,
            coupleColorTempToLevelMinMireds: 1,
          };

          makeCapabilityInstance('light_temperature', async value => {
            await endpoint.set({
              colorControl: {
                colorTemperatureMireds: scaleNumber(value, 0, 1, 1, 1000) ?? 500,
              },
            });
          });
        }

        if (device.capabilitiesObj?.light_hue && device.capabilitiesObj?.light_saturation && !device.capabilitiesObj?.light_temperature) {
          endpointServers.push(HomeyColorControlServer.with(ColorControl.Feature.ColorTemperature)); // Only Color
        } else if (!device.capabilitiesObj?.light_hue && !device.capabilitiesObj?.light_saturation && device.capabilitiesObj?.light_temperature) {
          endpointServers.push(HomeyColorControlServer.with(ColorControl.Feature.HueSaturation)); // Only Temperature
        } else {
          endpointServers.push(HomeyColorControlServer.with(ColorControl.Feature.HueSaturation, ColorControl.Feature.ColorTemperature)); // Both Color & Temperature
        }

        if (device.capabilitiesObj?.light_hue
          && device.capabilitiesObj?.light_saturation
          && device.capabilitiesObj?.light_temperature) {
          endpointClass = ExtendedColorLightDevice;

          switch (device.capabilitiesObj?.light_mode?.value) {
            case 'color': {
              endpointProperties.colorControl.colorMode = ColorControl.ColorMode.CurrentHueAndCurrentSaturation;
              delete endpointProperties.colorControl.colorTemperatureMireds;
              break;
            }
            case 'temperature': {
              endpointProperties.colorControl.colorMode = ColorControl.ColorMode.ColorTemperatureMireds;
              delete endpointProperties.colorControl.currentHue;
              delete endpointProperties.colorControl.currentSaturation;
              break;
            }
          }
        }

        if (device.capabilitiesObj?.light_mode) {
          makeCapabilityInstance('light_mode', async value => {
            // TODO: Apple Home does not seem to change the mode when this method is called.
            switch (value) {
              case 'color': {
                await endpoint.set({
                  colorControl: {
                    colorMode: ColorControl.ColorMode.ColorTemperatureMireds,
                  },
                });
                break;
              }
              case 'temperature': {
                await endpoint.set({
                  colorControl: {
                    colorMode: ColorControl.ColorMode.CurrentHueAndCurrentSaturation,
                  },
                });
                break;
              }
            }
          });
        }

        const endpoint = new Endpoint(endpointClass.with(...endpointServers), endpointProperties);
        await deviceEndpoint.add(endpoint);

        break;
      }

      case 'thermostat': {
        class HomeyThermostatServer extends ThermostatServer {
          async setTargetTemperature(value) { // TODO
            await device.setCapabilityValue({
              capabilityId: 'target_temperature',
              value: Math.round(value * 100),
            });
          }
        }

        const endpoint = new Endpoint(ThermostatDevice.with(
          HomeyThermostatServer,
          TemperatureMeasurementServer,
        ), {
          id: 'main',
          thermostat: {
            controlSequenceOfOperation: Thermostat.ControlSequenceOfOperation.CoolingAndHeatingWithReheat, // TODO: Base on enum thermostat_mode
            //   measuredValue: typeof device.capabilitiesObj?.measure_temperature?.value === 'number'
            //     ? Math.round(device.capabilitiesObj?.measure_temperature?.value * 100)
            //     : null,
            // },
          },
          temperatureMeasurement: {
            measuredValue: typeof device.capabilitiesObj?.measure_temperature?.value === 'number'
              ? Math.round(device.capabilitiesObj?.measure_temperature?.value * 100)
              : null,
          },
        });
        await deviceEndpoint.add(endpointThermostat);

        makeCapabilityInstance('measure_temperature', async value => {
          await endpoint.set({
            temperatureMeasurement: {
              measuredValue: typeof value === 'number'
                ? Math.round(value * 100)
                : null,
            },
          });
        });

        makeCapabilityInstance('target_temperature', async value => {
          await endpoint.set({
            targetTemperature: {
              targetValue: typeof value === 'number'
                ? Math.round(value * 100)
                : null,
            },
          });
        });

        break;
      }

      case 'sensor': {
        if (device.capabilitiesObj?.measure_temperature) {
          const endpoint = new Endpoint(TemperatureSensorDevice.with(TemperatureMeasurementServer), {
            id: 'measure_temperature',
            temperatureMeasurement: {
              measuredValue: typeof device.capabilitiesObj?.measure_temperature?.value === 'number'
                ? Math.round(device.capabilitiesObj?.measure_temperature?.value * 100)
                : null,
            },
          });
          await deviceEndpoint.add(endpoint);

          makeCapabilityInstance('measure_temperature', async value => {
            await endpoint.set({
              temperatureMeasurement: {
                measuredValue: typeof value === 'number'
                  ? Math.round(value * 100)
                  : null,
              },
            });
          });
        }

        if (device.capabilitiesObj?.measure_humidity) {
          const endpoint = new Endpoint(HumiditySensorDevice.with(RelativeHumidityMeasurementServer), {
            id: 'measure_humidity',
            relativeHumidityMeasurement: {
              measuredValue: typeof device.capabilitiesObj?.measure_humidity?.value === 'number'
                ? Math.round(device.capabilitiesObj?.measure_humidity?.value * 100)
                : null,
            },
          });
          await deviceEndpoint.add(endpoint);

          makeCapabilityInstance('measure_humidity', async value => {
            await endpoint.set({
              relativeHumidityMeasurement: {
                measuredValue: typeof value === 'number'
                  ? Math.round(value * 100)
                  : null,
              },
            });
          });
        }

        if (device.capabilitiesObj?.measure_co) {
          const endpoint = new Endpoint(SmokeCoAlarmDevice.with(CarbonMonoxideConcentrationMeasurementServer.with('NumericMeasurement')), {
            id: 'measure_co',
            carbonMonoxideConcentrationMeasurement: {
              measurementUnit: ConcentrationMeasurement.MeasurementUnit.Ppm,
              measurementMedium: ConcentrationMeasurement.MeasurementMedium.Air,
              measuredValue: typeof device.capabilitiesObj?.measure_co?.value === 'number'
                ? Math.round(device.capabilitiesObj?.measure_co?.value)
                : null,
            },
          });
          await deviceEndpoint.add(endpoint);

          makeCapabilityInstance('measure_co', async value => {
            await endpoint.set({
              carbonMonoxideConcentrationMeasurement: {
                measuredValue: typeof value === 'number'
                  ? Math.round(value)
                  : null,
              },
            });
          });
        }

        if (device.capabilitiesObj?.measure_co2) {
          const endpoint = new Endpoint(AirQualitySensorDevice.with(CarbonDioxideConcentrationMeasurementServer.with('NumericMeasurement')), {
            id: 'measure_co2',
            carbonDioxideConcentrationMeasurement: {
              measurementUnit: ConcentrationMeasurement.MeasurementUnit.Ppm,
              measurementMedium: ConcentrationMeasurement.MeasurementMedium.Air,
              measuredValue: typeof device.capabilitiesObj?.measure_co2?.value === 'number'
                ? Math.round(device.capabilitiesObj?.measure_co2?.value)
                : null,
            },
          });
          await deviceEndpoint.add(endpoint);

          makeCapabilityInstance('measure_co2', async value => {
            await endpoint.set({
              carbonDioxideConcentrationMeasurement: {
                measuredValue: typeof value === 'number'
                  ? Math.round(value)
                  : null,
              },
            });
          });
        }

        if (device.capabilitiesObj?.measure_pm10) {
          const endpoint = new Endpoint(AirQualitySensorDevice.with(Pm10ConcentrationMeasurementServer.with('NumericMeasurement')), {
            id: 'measure_pm10',
            pm10ConcentrationMeasurement: {
              measurementUnit: ConcentrationMeasurement.MeasurementUnit.Ugm3,
              measurementMedium: ConcentrationMeasurement.MeasurementMedium.Air,
              measuredValue: typeof device.capabilitiesObj?.measure_pm10?.value === 'number'
                ? Math.round(device.capabilitiesObj?.measure_pm10?.value)
                : null,
            },
          });
          await deviceEndpoint.add(endpoint);

          makeCapabilityInstance('measure_pm10', async value => {
            await endpoint.set({
              pm10ConcentrationMeasurement: {
                measuredValue: typeof value === 'number'
                  ? Math.round(value)
                  : null,
              },
            });
          });
        }

        if (device.capabilitiesObj?.measure_pm25) {
          const endpoint = new Endpoint(AirQualitySensorDevice.with(Pm25ConcentrationMeasurementServer.with('NumericMeasurement')), {
            id: 'measure_pm25',
            pm25ConcentrationMeasurement: {
              measurementUnit: ConcentrationMeasurement.MeasurementUnit.Ugm3,
              measurementMedium: ConcentrationMeasurement.MeasurementMedium.Air,
              measuredValue: typeof device.capabilitiesObj?.measure_pm25?.value === 'number'
                ? Math.round(device.capabilitiesObj?.measure_pm25?.value)
                : null,
            },
          });
          await deviceEndpoint.add(endpoint);

          makeCapabilityInstance('measure_pm25', async value => {
            await endpoint.set({
              pm25ConcentrationMeasurement: {
                measuredValue: typeof value === 'number'
                  ? Math.round(value)
                  : null,
              },
            });
          });
        }

        if (device.capabilitiesObj?.alarm_motion) {
          const endpoint = new Endpoint(OccupancySensorDevice.with(OccupancySensingServer.with(OccupancySensing.Feature.PassiveInfrared)), {
            id: 'alarm_motion',
            occupancySensing: {
              occupancy: {
                occupied: device.capabilitiesObj?.alarm_motion?.value === true,
              },
            },
          });
          await deviceEndpoint.add(endpoint);

          makeCapabilityInstance('alarm_motion', async value => {
            await endpoint.set({
              occupancySensing: {
                occupancy: {
                  occupied: value === true,
                },
              },
            });
          });
        }

        if (device.capabilitiesObj?.alarm_occupancy) {
          const endpoint = new Endpoint(OccupancySensorDevice.with(OccupancySensingServer.with(OccupancySensing.Feature.RfSensing)), {
            id: 'alarm_motion',
            occupancySensing: {
              occupancy: {
                occupied: device.capabilitiesObj?.alarm_motion?.value === true,
              },
            },
          });
          await deviceEndpoint.add(endpoint);

          makeCapabilityInstance('alarm_motion', async value => {
            await endpoint.set({
              occupancySensing: {
                occupancy: {
                  occupied: value === true,
                },
              },
            });
          });
        }

        if (device.capabilitiesObj?.alarm_smoke) {
          const endpoint = new Endpoint(SmokeCoAlarmDevice.with(SmokeCoAlarmServer.with('SmokeAlarm')), {
            id: 'alarm_smoke',
            smokeCoAlarm: {
              smokeState: device.capabilitiesObj?.alarm_smoke?.value === true
                ? SmokeCoAlarm.AlarmState.Critical
                : SmokeCoAlarm.AlarmState.Normal,
            },
          });
          await deviceEndpoint.add(endpoint);

          makeCapabilityInstance('alarm_smoke', async value => {
            await endpoint.set({
              smokeCoAlarm: {
                smokeState: value === true
                  ? SmokeCoAlarm.AlarmState.Critical
                  : SmokeCoAlarm.AlarmState.Normal,
              },
            });
          });
        }

        break;
      }
    }
  }

  async __uninitDevice(device) {
    this.debug(`Uninitializing ${device.name} (${device.id})`);

    const deviceEndpoint = this.deviceEndpoints[device.id];
    if (!deviceEndpoint) return;

    // Delete the Matter Device Endpoint
    await deviceEndpoint.delete();

    // Unsubscribe all Homey Capability Instances
    const deviceCapabilityInstances = this.deviceCapabilityInstances[device.id] || {};
    for (const [deviceCapabilityId, deviceCapabilityInstance] of Object.entries(deviceCapabilityInstances)) {
      deviceCapabilityInstance.destroy();
      delete this.deviceCapabilityInstances[device.id][deviceCapabilityId];
    }

    delete this.deviceEndpoints[device.id];
    delete this.deviceCapabilityInstances[device.id];
  }

}

function scaleNumber(value, minInput, maxInput, minOutput, maxOutput) {
  const scaledValue = ((value - minInput) / (maxInput - minInput)) * (maxOutput - minOutput) + minOutput;
  return Math.min(Math.max(scaledValue, minOutput), maxOutput);
}

function ellipseString(value, maxLength = 32) {
  if (typeof value !== 'string') {
    console.trace('ellipseString')
    return null;
  }
  if (value.length > maxLength) {
    return value.substring(0, maxLength - 3) + '…';
  }
  return value;
}

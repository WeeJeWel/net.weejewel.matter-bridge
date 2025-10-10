import { Endpoint, Environment, StorageService, ServerNode, VendorId } from '@matter/main';
import { BridgedNodeEndpoint } from '@matter/main/endpoints/bridged-node';

import {
  ElectricalPowerMeasurement,
  ConcentrationMeasurement,
  Thermostat,
  TemperatureControl,
  ColorControl,
  SmokeCoAlarm,
  OccupancySensing,
  WindowCovering,
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
  ContactSensorDevice,
  WindowCoveringDevice,
} from '@matter/main/devices';
import {
  OnOffServer,
  LevelControlServer,
  ColorControlServer,
  TemperatureMeasurementServer,
  TemperatureControlServer,
  RelativeHumidityMeasurementServer,
  CarbonMonoxideConcentrationMeasurementServer,
  CarbonDioxideConcentrationMeasurementServer,
  Pm10ConcentrationMeasurementServer,
  Pm25ConcentrationMeasurementServer,
  OccupancySensingServer,
  SmokeCoAlarmServer,
  ElectricalPowerMeasurementServer,
  ThermostatServer,
  BooleanStateServer,
  WindowCoveringServer,
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
    this.aggregatorEndpoint = new Endpoint(AggregatorEndpoint, {
      id: 'aggregator',
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
        // TODO: If device is not ready, add listener for when it becomes ready, and then initialize the device
        // Also attach a listener when the device is uninitialized or deleted, to uninitialize the device
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
      if (!device.capabilitiesObj?.[capabilityId]) return;

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
          endpointProperties.colorControl = {
            ...endpointProperties.colorControl,
            colorMode: ColorControl.ColorMode.CurrentHueAndCurrentSaturation,
            currentHue: scaleAndRoundNumber(device.capabilitiesObj?.light_hue?.value, 0, 1, 0, 254) ?? 0,
            currentSaturation: scaleAndRoundNumber(device.capabilitiesObj?.light_saturation?.value, 0, 1, 0, 254) ?? 0,
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
          endpointProperties.colorControl = {
            ...endpointProperties.colorControl,
            colorMode: ColorControl.ColorMode.ColorTemperatureMireds,
            colorTemperatureMireds: scaleNumber(device.capabilitiesObj?.light_temperature?.value, 0, 1, 1, 1000) ?? 500,
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
          endpointClass = DimmableLightDevice;
          endpointServers.push(HomeyColorControlServer.with(ColorControl.Feature.HueSaturation)); // Only Color
        } else if (!device.capabilitiesObj?.light_hue && !device.capabilitiesObj?.light_saturation && device.capabilitiesObj?.light_temperature) {
          endpointClass = ColorTemperatureLightDevice;
          endpointServers.push(HomeyColorControlServer.with(ColorControl.Feature.ColorTemperature)); // Only Temperature
        } else if (device.capabilitiesObj?.light_hue && device.capabilitiesObj?.light_saturation && device.capabilitiesObj?.light_temperature) {
          endpointClass = ExtendedColorLightDevice;
          endpointServers.push(HomeyColorControlServer.with(ColorControl.Feature.HueSaturation, ColorControl.Feature.ColorTemperature)); // Both Color & Temperature
        }

        if (device.capabilitiesObj?.light_hue
          && device.capabilitiesObj?.light_saturation
          && device.capabilitiesObj?.light_temperature) {

          switch (device.capabilitiesObj?.light_mode?.value) {
            case null:
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
        // TODO: Use target_temperature.cool if mode is auto

        const thermostatServerFeatures = [];
        if (device.capabilitiesObj?.thermostat_mode) {
          thermostatServerFeatures.push(Thermostat.Feature.Heating);
          thermostatServerFeatures.push(Thermostat.Feature.AutoMode);
          thermostatServerFeatures.push(Thermostat.Feature.Cooling);
        } else {
          thermostatServerFeatures.push(Thermostat.Feature.Heating);
        }

        const endpoint = new Endpoint(ThermostatDevice.with(
          class extends ThermostatServer.with(...thermostatServerFeatures) {
            async setpointRaiseLower() {
              console.log('setpointRaiseLower', arguments);
              // This is never called
            }
          },
          TemperatureMeasurementServer,
        ), {
          id: 'main',
          thermostat: {
            systemMode: (() => {
              switch (device.capabilitiesObj?.thermostat_mode?.value) {
                case 'off': return Thermostat.SystemMode.Off;
                case 'auto': return Thermostat.SystemMode.Auto;
                case 'cool': return Thermostat.SystemMode.Cool;
                case 'heat': return Thermostat.SystemMode.Heat;
                default: return Thermostat.SystemMode.Heat;
              }
            })(),
            controlSequenceOfOperation: (() => {
              if (device.capabilitiesObj?.thermostat_mode) {
                return Thermostat.ControlSequenceOfOperation.CoolingAndHeating;
              } else {
                return Thermostat.ControlSequenceOfOperation.HeatingOnly;
              }
            })(),
            occupiedHeatingSetpoint: typeof device.capabilitiesObj?.target_temperature?.value === 'number'
              ? Math.round(device.capabilitiesObj?.target_temperature?.value * 100)
              : null,
            minHeatSetpointLimit: typeof device.capabilitiesObj?.target_temperature?.min === 'number'
              ? Math.round(device.capabilitiesObj?.target_temperature?.min * 100)
              : 0,
            absMinHeatSetpointLimit: typeof device.capabilitiesObj?.target_temperature?.min === 'number'
              ? Math.round(device.capabilitiesObj?.target_temperature?.min * 100)
              : 0,
            maxHeatSetpointLimit: typeof device.capabilitiesObj?.target_temperature?.max === 'number'
              ? Math.round(device.capabilitiesObj?.target_temperature?.max * 100)
              : 10000,
            absMaxHeatSetpointLimit: typeof device.capabilitiesObj?.target_temperature?.max === 'number'
              ? Math.round(device.capabilitiesObj?.target_temperature?.max * 100)
              : 10000,
            minSetpointDeadBand: 0,
          },
          temperatureMeasurement: {
            measuredValue: typeof device.capabilitiesObj?.measure_temperature?.value === 'number'
              ? Math.round(device.capabilitiesObj?.measure_temperature?.value * 100)
              : null,
          },
        });
        await deviceEndpoint.add(endpoint);

        endpoint.events.thermostat.events.occupiedHeatingSetpoint$Changing?.on(async value => {
          await device.setCapabilityValue({
            capabilityId: 'target_temperature',
            value: Math.round(value / 100),
          });
        });

        endpoint.events.thermostat.events.occupiedCoolingSetpoint$Changing?.on(async value => {
          if (device.capabilitiesObj?.['target_temperature.cool']) {
            await device.setCapabilityValue({
              capabilityId: 'target_temperature.cool',
              value: Math.round(value / 100),
            });
          }
        });

        endpoint.events.thermostat.events.systemMode$Changing.on(async value => {
          switch (value) {
            case Thermostat.SystemMode.Off: {
              await device.setCapabilityValue({
                capabilityId: 'thermostat_mode',
                value: 'off',
              });
              break;
            }
            case Thermostat.SystemMode.Auto: {
              await device.setCapabilityValue({
                capabilityId: 'thermostat_mode',
                value: 'auto',
              });
              break;
            }
            case Thermostat.SystemMode.Heat: {
              await device.setCapabilityValue({
                capabilityId: 'thermostat_mode',
                value: 'heat',
              });
              break;
            }
            case Thermostat.SystemMode.Cool: {
              await device.setCapabilityValue({
                capabilityId: 'thermostat_mode',
                value: 'cool',
              });
              break;
            }
          }
        });

        makeCapabilityInstance('measure_temperature', async value => {
          await endpoint.set({
            temperatureMeasurement: {
              measuredValue: typeof value === 'number'
                ? value
                : null,
            },
          });
        });

        makeCapabilityInstance('target_temperature', async value => {
          await endpoint.set({
            thermostat: {
              occupiedHeatingSetpoint: typeof value === 'number'
                ? Math.round(value * 100)
                : null,
            },
          });
        });

        makeCapabilityInstance('thermostat_mode', async value => {
          switch (value) {
            case 'off': {
              await endpoint.set({
                thermostat: {
                  systemMode: Thermostat.SystemMode.Off,
                },
              });
              break;
            }
            case 'auto': {
              await endpoint.set({
                thermostat: {
                  systemMode: Thermostat.SystemMode.Auto,
                },
              });
              break;
            }
            case 'heat': {
              await endpoint.set({
                thermostat: {
                  systemMode: Thermostat.SystemMode.Heat,
                },
              });
              break;
            }
            case 'cool': {
              await endpoint.set({
                thermostat: {
                  systemMode: Thermostat.SystemMode.Cool,
                },
              });
              break;
            }
          }
        });

        break;
      }

      case 'windowcoverings':
      case 'blinds':
      case 'shutterblinds':
      case 'curtain': {
        if (device.capabilitiesObj?.windowcoverings_set) {
          const HomeyWindowConveringServer = class extends WindowCoveringServer.with(
            WindowCovering.Feature.Lift,
            WindowCovering.Feature.PositionAwareLift,
          ) {

            async goToLiftPercentage({ liftPercent100thsValue }) {
              await device.setCapabilityValue({
                capabilityId: 'windowcoverings_set',
                value: 1 - scaleNumber(liftPercent100thsValue, 0, 10000, 0, 1),
              });
            }

          }

          const endpoint = new Endpoint(WindowCoveringDevice.with(HomeyWindowConveringServer), {
            id: 'main',
            windowCovering: {
              targetPositionLiftPercent100ths: typeof device.capabilitiesObj?.windowcoverings_set?.value === 'number'
                ? 10000 - scaleNumber(device.capabilitiesObj?.windowcoverings_set?.value, 0, 1, 0, 10000)
                : 5000,
              currentPositionLiftPercent100ths: typeof device.capabilitiesObj?.windowcoverings_set?.value === 'number'
                ? 10000 - scaleNumber(device.capabilitiesObj?.windowcoverings_set?.value, 0, 1, 0, 10000)
                : null,
            }
          });
          await deviceEndpoint.add(endpoint);

          makeCapabilityInstance('windowcoverings_set', async value => {
            await endpoint.set({
              windowCovering: {
                currentPositionLiftPercent100ths: typeof value === 'number'
                  ? 10000 - scaleNumber(value, 0, 1, 0, 10000)
                  : 5000,
                targetPositionLiftPercent100ths: typeof value === 'number'
                  ? 10000 - scaleNumber(value, 0, 1, 0, 10000)
                  : 5000,
              },
            });
          });
        }

        else if (device.capabilitiesObj?.windowcoverings_state) {
          const HomeyWindowConveringServer = class extends WindowCoveringServer.with(
            WindowCovering.Feature.Lift,
          ) {

            async upOrOpen() {
              await device.setCapabilityValue({
                capabilityId: 'windowcoverings_state',
                value: 'up',
              });
            }

            async downOrClose() {
              await device.setCapabilityValue({
                capabilityId: 'windowcoverings_state',
                value: 'down',
              });
            }

            async stopMotion() {
              await device.setCapabilityValue({
                capabilityId: 'windowcoverings_state',
                value: 'idle',
              });
            }

          }

          const endpoint = new Endpoint(WindowCoveringDevice.with(HomeyWindowConveringServer), {
            id: 'main',
            windowCovering: {
              operationalStatus: {
                lift: (() => {
                  switch (device.capabilitiesObj?.windowcoverings_state?.value) {
                    case 'up': return WindowCovering.MovementStatus.Opening;
                    case 'down': return WindowCovering.MovementStatus.Closing;
                    case 'idle': return WindowCovering.MovementStatus.Stopped;
                    default: return WindowCovering.MovementStatus.Stopped;
                  }
                })(),
              },
            }
          });
          await deviceEndpoint.add(endpoint);

          // Note: The status seems to be synced, but it doesn't show up in Apple Home.
          makeCapabilityInstance('windowcoverings_state', async value => {
            switch (value) {
              case 'up': {
                await endpoint.set({
                  windowCovering: {
                    operationalStatus: {
                      lift: WindowCovering.MovementStatus.Opening,
                    },
                  },
                });
                break;
              }
              case 'down': {
                await endpoint.set({
                  windowCovering: {
                    operationalStatus: {
                      lift: WindowCovering.MovementStatus.Closing,
                    },
                  },
                });
                break;
              }
              case 'idle': {
                await endpoint.set({
                  windowCovering: {
                    operationalStatus: {
                      lift: WindowCovering.MovementStatus.Stopped,
                    },
                  },
                });
                break;
              }
            }
          });
        }

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

        if (device.capabilitiesObj?.alarm_contact) { // TODO: See this working in Apple Home
          const endpoint = new Endpoint(ContactSensorDevice.with(BooleanStateServer), {
            id: 'alarm_contact',
            booleanState: {
              stateValue: device.capabilitiesObj?.alarm_contact?.value === true,
            },
          });
          await deviceEndpoint.add(endpoint);

          makeCapabilityInstance('alarm_contact', async value => {
            await endpoint.set({
              booleanState: {
                stateValue: value === true,
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

function scaleAndRoundNumber(...props) {
  return Math.round(scaleNumber(...props));
}

function ellipseString(value, maxLength = 32) {
  if (typeof value !== 'string') return null;
  if (value.length > maxLength) return value.substring(0, maxLength - 3) + '…';
  return value;
}

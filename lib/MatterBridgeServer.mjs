import { Endpoint, Environment, StorageService, ServerNode, VendorId } from '@matter/main';
import { BridgedNodeEndpoint } from '@matter/main/endpoints/bridged-node';
import { BridgedDeviceBasicInformationServer } from '@matter/main/behaviors/bridged-device-basic-information';
import { FixedLabelServer } from '@matter/main/behaviors/fixed-label';

// import { ElectricalSensorEndpoint, ElectricalSensorRequirements } from '@matter/main/endpoints/electrical-sensor';
import {
  ElectricalPowerMeasurement,
  ConcentrationMeasurement,
} from '@matter/main/clusters';
import {
  AggregatorEndpoint,

  // ElectricalSensorEndpoint,
  // ElectricalSensorRequirements,

  // TemperatureSensorDevice,
  OnOffLightEndpoint,
  ElectricalSensorEndpoint,
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
} from '@matter/main/devices';
import {
  OnOffServer,
  LevelControlServer,
  TemperatureMeasurementServer,
  RelativeHumidityMeasurementServer,
  CarbonDioxideConcentrationMeasurementServer,
  ElectricalPowerMeasurementServer,
} from '@matter/main/behaviors';
import {
  MeasurementType,
} from '@matter/main/types';
import {
  TemperatureMeasurement,
} from '@matter/main/model';

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

    // Set storage location
    this.environment = Environment.default;

    this.storageService = this.environment.get(StorageService);
    this.storageService.location = storageServiceLocation;
  }

  async start() {
    // Create the Server
    this.server = await ServerNode.create({
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
        productId: ellipseString(this.productId),
        serialNumber: ellipseString(this.serialNumber),
        uniqueId: ellipseString(this.uniqueId),
      },
    });

    // Create an Aggregator Endpoint and start the Server
    this.aggregator = new Endpoint(AggregatorEndpoint, {
      id: 'aggregator',
    });
    await this.server.add(this.aggregator);
    await this.server.start();

    // Get all Homey Devices
    await this.api.devices.connect();
    this.devices = await this.api.devices.getDevices();

    // Get all Homey Drivers
    await this.api.drivers.connect();
    this.drivers = await this.api.drivers.getDrivers();

    // Loop all Homey Devices
    await Promise.all(Object.entries(this.devices).map(async ([deviceId, device]) => {
      // Calculate the device's class
      const deviceClass = device.virtualClass || device.class;

      // Get the device's driver
      const driver = this.drivers[device.driverId];

      // Create a Matter Endpoint
      const endpointDevice = new Endpoint(BridgedNodeEndpoint, {
        id: deviceId,
        bridgedDeviceBasicInformation: {
          nodeLabel: ellipseString(device.name),
          vendorName: ellipseString(driver.ownerName),
          productName: ellipseString(driver.name),
          serialNumber: ellipseString(deviceId.replaceAll('-', '')), // Max length is 32, so if we remove the dashes from the UUIDv4, it fits!
        },
      });
      await this.aggregator.add(endpointDevice);

      // Class — Light
      if (deviceClass === 'light') {
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
            await device.setCapabilityValue({
              capabilityId: 'dim',
              value: scaleNumber(level, 1, 254, 0, 1),
            });
            await device.setCapabilityValue({
              capabilityId: 'onoff',
              value: level > 1, // TODO
            });
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

        // Brightness + On/Off
        if (device.capabilitiesObj?.onoff && device.capabilitiesObj?.dim) {
          const endpointLight = new Endpoint(DimmableLightDevice.with(
            FixedLabelServer,
            HomeyOnOffServer,
            HomeyLevelControlServer,
          ), {
            id: 'light',
            fixedLabel: {
              labelList: [{
                label: 'name',
                value: device.capabilitiesObj?.dim?.title,
              }],
            },
            onOff: {
              onOff: device.capabilitiesObj?.onoff?.value,
            },
            levelControl: {
              currentLevel: scaleNumber(device.capabilitiesObj?.dim?.value, 0, 1, 1, 254),
              minLevel: 1,
              maxLevel: 254,
            },
          });
          await endpointDevice.add(endpointLight);

          device.makeCapabilityInstance('onoff', value => {
            endpointLight.set({
              onOff: {
                onOff: value,
              },
            });
          });

          device.makeCapabilityInstance('dim', value => {
            endpointLight.set({
              levelControl: {
                currentLevel: scaleNumber(value, 0, 1, 1, 254),
              },
            });
          });
        }

        // Only On/Off
        else if (device.capabilitiesObj?.onoff) {
          const endpointLight = new Endpoint(OnOffLightDevice.with(
            FixedLabelServer,
            HomeyOnOffServer
          ), {
            id: 'light',
            fixedLabel: {
              labelList: [{
                label: 'name',
                value: device.capabilitiesObj?.onoff?.title,
              }],
            },
            onOff: {
              onOff: device.capabilitiesObj?.onoff?.value,
            },
          });
          await endpointDevice.add(endpointLight);

          device.makeCapabilityInstance('onoff', value => {
            endpointLight.set({
              onOff: {
                onOff: value,
              },
            });
          });
        }

        return;
      }

      // Class — Thermostat
      // if (deviceClass === 'thermostat') {
      //   class HomeyThermostatServer extends ThermostatRequirements.ThermostatServer {
      //     async setTemperature(value) {

      //     }

      //     async setTargetTemperature(value) {
      //       await device.setCapabilityValue({
      //         capabilityId: 'target_temperature',
      //         value: Math.round(value * 100),
      //       });
      //     }
      //   }

      //   const endpointThermostat = new Endpoint(ThermostatDevice.with(
      //     FixedLabelServer,
      //     HomeyThermostatServer
      //   ), {
      //     id: 'thermostat',
      //     fixedLabel: {
      //       labelList: [{
      //         label: 'name',
      //         value: device.capabilitiesObj?.measure_temperature?.title,
      //       }],
      //     },
      //     temperatureMeasurement: {
      //       measuredValue: typeof device.capabilitiesObj?.measure_temperature?.value === 'number'
      //         ? Math.round(device.capabilitiesObj?.measure_temperature?.value * 100)
      //         : null,
      //     },
      //     targetTemperature: {
      //       targetValue: typeof device.capabilitiesObj?.target_temperature?.value === 'number'
      //         ? Math.round(device.capabilitiesObj?.target_temperature?.value * 100)
      //         : null,
      //     },
      //   });
      //   await endpointDevice.add(endpointThermostat);

      //   device.makeCapabilityInstance('measure_temperature', value => {
      //     endpointThermostat.set({
      //       temperatureMeasurement: {
      //         measuredValue: typeof value === 'number'
      //           ? Math.round(value * 100)
      //           : null,
      //       },
      //     });
      //   });

      //   device.makeCapabilityInstance('target_temperature', value => {
      //     endpointThermostat.set({
      //       targetTemperature: {
      //         targetValue: typeof value === 'number'
      //           ? Math.round(value * 100)
      //           : null,
      //       },
      //     });
      //   });
      // }

      // Capability — On/Off
      if (device.capabilitiesObj?.onoff) {
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

        const endpointOnOff = new Endpoint(OnOffPlugInUnitDevice.with(FixedLabelServer, HomeyOnOffServer), {
          id: 'onoff',
          fixedLabel: {
            labelList: [{
              label: 'name',
              value: device.capabilitiesObj?.onoff?.title,
            }],
          },
          onOff: {
            onOff: device.capabilitiesObj?.onoff?.value,
          },
        });
        await endpointDevice.add(endpointOnOff);

        device.makeCapabilityInstance('onoff', value => {
          endpointOnOff.set({
            onOff: {
              onOff: value,
            },
          });
        });
      }

      // Capability — Measure Temperature
      if (device.capabilitiesObj?.measure_temperature) {
        const endpoint = new Endpoint(TemperatureSensorDevice.with(
          FixedLabelServer,
          TemperatureMeasurementServer,
        ), {
          id: 'measure_temperature',
          fixedLabel: {
            labelList: [{
              label: 'name',
              value: device.capabilitiesObj?.measure_temperature?.title,
            }],
          },
          temperatureMeasurement: {
            measuredValue: typeof device.capabilitiesObj?.measure_temperature?.value === 'number'
              ? Math.round(device.capabilitiesObj?.measure_temperature?.value * 100)
              : null,
          },
        });
        await endpointDevice.add(endpoint);

        device.makeCapabilityInstance('measure_temperature', value => {
          endpoint.set({
            temperatureMeasurement: {
              measuredValue: typeof value === 'number'
                ? Math.round(value * 100)
                : null,
            },
          });
        });
      }

      // Capability — Measure Humidity
      if (device.capabilitiesObj?.measure_humidity) {
        const endpoint = new Endpoint(HumiditySensorDevice.with(
          FixedLabelServer,
          RelativeHumidityMeasurementServer,
        ), {
          id: 'measure_humidity',
          fixedLabel: {
            labelList: [{
              label: 'name',
              value: device.capabilitiesObj?.measure_humidity?.title,
            }],
          },
          relativeHumidityMeasurement: {
            measuredValue: typeof device.capabilitiesObj?.measure_humidity?.value === 'number'
              ? Math.round(device.capabilitiesObj?.measure_humidity?.value * 100)
              : null,
          },
        });
        await endpointDevice.add(endpoint);

        device.makeCapabilityInstance('measure_humidity', value => {
          endpoint.set({
            relativeHumidityMeasurement: {
              measuredValue: typeof value === 'number'
                ? Math.round(value * 100)
                : null,
            },
          });
        });
      }

      // Capability — Measure CO2
      if (device.capabilitiesObj?.measure_co2) {
        const endpoint = new Endpoint(AirQualitySensorDevice.with(
          FixedLabelServer,
          CarbonDioxideConcentrationMeasurementServer.with('NumericMeasurement'),
        ), {
          id: 'measure_co2',
          fixedLabel: {
            labelList: [{
              label: 'name',
              value: device.capabilitiesObj?.measure_co2?.title,
            }],
          },
          carbonDioxideConcentrationMeasurement: {
            measurementUnit: ConcentrationMeasurement.MeasurementUnit.Ppm,
            measurementMedium: ConcentrationMeasurement.MeasurementMedium.Air,
            measuredValue: typeof device.capabilitiesObj?.measure_co2?.value === 'number'
              ? Math.round(device.capabilitiesObj?.measure_co2?.value)
              : null,
          },
        });
        await endpointDevice.add(endpoint);

        device.makeCapabilityInstance('measure_co2', value => {
          endpoint.set({
            carbonDioxideConcentrationMeasurement: {
              measuredValue: typeof value === 'number'
                ? Math.round(value)
                : null,
            },
          });
        });
      }

      // Capability — Measure Power
      // Note: I have not seen this working in Apple Home yet.
      if (device.capabilitiesObj?.measure_power) {
        const endpoint = new Endpoint(ElectricalSensorEndpoint.with(FixedLabelServer, ElectricalPowerMeasurementServer), {
          id: 'measure_power',
          fixedLabel: {
            labelList: [{
              label: 'name',
              value: device.capabilitiesObj?.measure_power?.title,
            }],
          },
          electricalPowerMeasurement: {
            powerMode: ElectricalPowerMeasurement.PowerMode.Ac,
            numberOfMeasurementTypes: 1,
            activePower: device.capabilitiesObj?.measure_power?.value,
            accuracy: [
              {
                measurementType: MeasurementType.ActivePower, // mW
                measured: true,
                minMeasuredValue: Number.MIN_SAFE_INTEGER,
                maxMeasuredValue: Number.MAX_SAFE_INTEGER,
                accuracyRanges: [{
                  rangeMin: Number.MIN_SAFE_INTEGER,
                  rangeMax: Number.MAX_SAFE_INTEGER,
                  fixedMax: 1,
                }],
              },
            ],
          },
        });
        await endpointDevice.add(endpoint);

        device.makeCapabilityInstance('measure_power', value => {
          endpoint.set({
            electricalPowerMeasurement: {
              activePower: value,
            },
          });
        });
      }
    }));
  }

}

function scaleNumber(value, minInput, maxInput, minOutput, maxOutput) {
  const scaledValue = ((value - minInput) / (maxInput - minInput)) * (maxOutput - minOutput) + minOutput;
  return Math.min(Math.max(scaledValue, minOutput), maxOutput);
}

function ellipseString(value, maxLength = 32) {
  if (value.length > maxLength) {
    return value.substring(0, maxLength - 3) + '…';
  }
  return value;
}
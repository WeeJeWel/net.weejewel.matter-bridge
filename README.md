# Matter Bridge for Homey Pro

This app exposes Homey Pro's devices to Matter, so users can include them in Apple Home, Google Home etc.

## Usage

```bash
$ homey app run --remote
```

We need to run with `--remote` due to the userdata, mDNS advertisements and IP address.

## Usage (Standalone)

To run on your Mac/Linux PC for faster debugging:

```bash
$ npm run standalone
```

This will run a separate server, but you don't need to upload it to Homey Pro every time, which saves a lot of precious development time. It automatically reloads on file changes.

Scan the QR Code in the terminal with e.g. Apple Home to perform the initial pairing.

> See .envrc.sample for the required environment variables.

## Specification

Download the latest *Matter Application Cluster Specification* from https://csa-iot.org/developer-resource/specifications-download-request/.
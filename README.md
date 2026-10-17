# ioBroker ArtNet DMX Monitor

**A lightweight Art-Net / DMX monitor with optional ArtPoll discovery for ioBroker.**

ioBroker ArtNet DMX Monitor receives Art-Net ArtDMX packets and exposes individual DMX channels as ioBroker states. It provides a simple way to integrate incoming lighting and DMX values into smart home automations, scripts, dashboards, and visualizations.

The adapter operates independently of other Art-Net adapters. It does not record or transmit ArtDMX data. When ArtPoll discovery is enabled, it transmits only ArtPollReply discovery responses.

## Features

- **1–512 DMX channels** configurable as individual ioBroker states, with values from **0–255**.
- **Automatic channel management:** creates configured channel states and removes channels no longer selected when the adapter starts.
- **Efficient updates:** optionally writes only changed DMX values (enabled by default).
- **Configurable receiver:** bind address, UDP port, Art-Net Port-Address / Universe, first channel, channel count, and receive timeout.
- **Port-conflict diagnostics:** checks other configured ioBroker Art-Net instances at startup and every 10 minutes without touching the UDP listener; also reports UDP bind conflicts.
- **Monitoring states:** connection status, last sender, packet count, last packet time, current universe, and port-conflict status.
- **Art-Net 4 discovery:** optionally responds to ArtPoll with an ArtPollReply describing one virtual DMX receiver port, even when no DMX data is arriving.

## Maintainer and attribution

Maintained by **xxLightbeamerxx**. Developed with assistance from **OpenAI ChatGPT**. Inspired by the MIT-licensed [ioBroker Art-Net Recorder](https://github.com/Bannsaenger/ioBroker.artnet-recorder) by Bannsaenger. Original copyright notices are retained for reused code (see [LICENSE](LICENSE)). Bug reports and improvement suggestions are welcome via GitHub Issues.

## Requirements

- ioBroker with **js-controller 5 or newer**.
- **Node.js 18 or newer**.
- An Art-Net transmitter delivering ArtDMX over UDP to the ioBroker host.
- An available UDP listening port (Art-Net conventionally uses **6454**).

## Installation

In ioBroker Admin, choose **Adapters → Install from custom URL / GitHub** and enter the repository URL:

```text
https://github.com/xxLightbeamerxx/ioBroker.artnet-dmx-monitor
```

Alternatively, install from the ioBroker host:

```bash
iobroker url https://github.com/xxLightbeamerxx/ioBroker.artnet-dmx-monitor
```

Create an instance if necessary:

```bash
iobroker add artnet-dmx-monitor
```

After installation, configure the receiver in **Instances**.

### Installation notes

Only one receiver should use a given IP address and UDP port at a time.

## Languages

The ioBroker Admin configuration provides **English and German** translations, following the language configured in ioBroker Admin.

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| Bind address | `0.0.0.0` | Local IPv4 interface to receive packets on |
| UDP port | `6454` | Art-Net UDP listening port |
| Art-Net Port-Address / Universe | `0` | Universe filter, value `0–32767` |
| First channel | `1` | First DMX channel to expose |
| Channel count | `64` | Number of channel states to expose (`1–512`, up to channel 512) |
| Write only changes | `true` | Avoid redundant state writes |
| Receive timeout | `10` seconds | Time without a matching packet before `info.receiving` becomes false |
| Respond to ArtPoll | `false` | Reply to valid ArtPoll discovery requests |
| ArtPoll short name | `ioB ArtNet Mon` | ASCII device name (1–17 characters) |

### Example: monitoring 64 DMX channels

With **First channel = 1** and **Channel count = 64**, states are created under:

```text
artnet-dmx-monitor.0
├── channel
│   ├── 001
│   ├── 002
│   ├── 003
│   ├── ...
│   └── 064
└── info
    ├── connection
    ├── receiving
    ├── portConflict
    ├── lastSender
    ├── lastPacket
    ├── packetCount
    └── universe
```

Individual channel states expose DMX values in the range `0–255`. Only values included in a received ArtDMX packet are updated; values from previous packets are retained if later packets contain fewer channels.

### Receiver and traffic status

- `info.connection`: true while the UDP listener is bound and ready, even if no DMX traffic is received. ioBroker uses this state for the “connected to device/service” indicator.
- `info.receiving`: true only when a matching DMX packet was received within the configured timeout.
- `info.portConflict`: indicates a detected UDP port conflict.

### Automatic channel cleanup

The adapter manages its own channel objects based on the selected range. If the channel count changes from **512 to 32** (with first channel set to 1), then after restarting the adapter:

- `channel.001` through `channel.032` remain.
- `channel.033` through `channel.512` are removed, including their stored state values.

Changing the first channel likewise removes objects outside the newly selected range. **Do not store irreplaceable information in generated channel states.**

## Art-Net device discovery (ArtPoll)

When **Respond to ArtPoll** is enabled, the adapter answers valid Art-Net 4 ArtPoll requests with a **unicast ArtPollReply** on UDP port 6454. The reply advertises the configured universe and a **virtual** ArtDMX receiving port; it does not claim to provide a physical DMX connector. Discovery is available even without incoming DMX. Responses are delayed by up to one second to reduce burst traffic.

For correct network discovery, choose a specific IPv4 bind address if the PC has multiple network interfaces. With `0.0.0.0`, the adapter selects the most relevant local interface based on the controller IP. A Firewall rule may be required to allow UDP 6454. Discovery replies are sent to UDP 6454 on the polling controller.

This feature implements ArtPoll/ArtPollReply discovery and does not claim complete Art-Net 4 implementation of every protocol feature. A true local IPv4 address is advertised rather than `0.0.0.0`.

## UDP port conflicts

Only **one Art-Net receiver** should be active on the same IP address and UDP port. This adapter does not intentionally enable socket sharing.

The adapter checks other configured ioBroker Art-Net instances at startup and every 10 minutes. This is an asynchronous, read-only metadata check: it never closes, rebinds, or probes the active UDP socket, so the DMX receiver remains uninterrupted. Warnings are emitted only when the set of detected conflicts changes. If binding the UDP socket fails because its address or port is already in use, it reports an error and sets `info.portConflict` accordingly where possible.

This cannot reliably detect other applications started after the monitor, or tell whether a different process is receiving packets; stop other Art-Net receivers using the same local IP/port before starting this adapter.

## Development and testing

```bash
npm install
npm run check
npm test
```

## Credits

**Art-Net protocol:** Art-Net™ Designed by and Copyright Artistic Licence Holdings Ltd. [Official Art-Net website](https://art-net.org.uk).

**Original project:** Inspired by [ioBroker Art-Net Recorder by Bannsaenger](https://github.com/Bannsaenger/ioBroker.artnet-recorder). Thanks to the original author and the ioBroker open-source community.

## License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for the license terms and notices referring to the original project.

---

*ioBroker ArtNet DMX Monitor — straightforward Art-Net channel monitoring for ioBroker.*

'use strict';

const os = require('node:os');
const dgram = require('node:dgram');
const ARTNET_ID = Buffer.from('Art-Net\0', 'ascii');

/** Recognize a valid ArtPoll message without mistaking ArtDMX packets for polls. */
function parseArtPoll(packet) {
    if (!Buffer.isBuffer(packet) || packet.length < 14) return null;
    if (!packet.subarray(0, 8).equals(ARTNET_ID) || packet.readUInt16LE(8) !== 0x2000) return null;
    if (packet.readUInt16BE(10) < 14) return null;
    return { flags: packet[12], priority: packet[13] };
}

function putAscii(buffer, offset, length, text) {
    Buffer.from(String(text), 'ascii').copy(buffer, offset, 0, length - 1);
}

/** Art-Net 4 ArtPollReply with a single VIRTUAL ArtDMX output universe (no physical DMX connector). */
function createArtPollReply({ ip, universe, shortName = 'ioBroker DMX Monitor', longName = 'ioBroker Art-Net DMX Monitor', receiving = false }) {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || ip.split('.').some(x => Number(x) > 255)) throw new Error('A real IPv4 address is required for ArtPollReply.');
    if (!Number.isInteger(universe) || universe < 0 || universe > 32767) throw new Error('Invalid Art-Net Port-Address.');
    const packet = Buffer.alloc(239);
    ARTNET_ID.copy(packet, 0);
    packet.writeUInt16LE(0x2100, 8);
    ip.split('.').forEach((octet, index) => { packet[10 + index] = Number(octet); });
    packet.writeUInt16LE(6454, 14); // Art-Net protocol port, regardless of local testing configuration.
    packet.writeUInt16BE(0x0100, 16); // Software revision 1.0.
    packet[18] = (universe >> 8) & 0x7f; // NetSwitch.
    packet[19] = (universe >> 4) & 0x0f; // SubSwitch.
    // OEM 0 means unregistered; do not impersonate an OEM.
    putAscii(packet, 26, 18, shortName);
    putAscii(packet, 44, 64, longName);
    putAscii(packet, 108, 64, '#0001 [0000] ioBroker virtual ArtDMX monitor');
    packet.writeUInt16BE(1, 172); // One virtual output port / universe.
    packet[174] = 0x80; // DMX512 output: consumes ArtDMX, not a physical DMX output.
    packet[182] = receiving ? 0x80 : 0x00; // GoodOutput: data currently being received.
    packet[190] = universe & 0x0f; // SwOut is the low nibble of Port-Address.
    packet[200] = 0x05; // StConfig: configuration/diagnostic software (virtual monitor).
    packet[207] = packet[10]; packet[208] = packet[11]; packet[209] = packet[12]; packet[210] = packet[13];
    packet[211] = 1; // Root bind index.
    packet[212] = 0x08; // Art-Net 4 support indicator.
    return packet;
}

function ipv4Number(ip) { return ip.split('.').reduce((a, x) => ((a << 8) | Number(x)) >>> 0, 0); }

/** Pick the best matching local NIC address when the UDP listener binds to 0.0.0.0. */
function pickLocalIp(bindAddress, remoteIp, interfaces = os.networkInterfaces()) {
    if (bindAddress !== '0.0.0.0') return bindAddress;
    const addresses = Object.values(interfaces).flat().filter(x => x && x.family === 'IPv4' && !x.internal);
    const remote = ipv4Number(remoteIp);
    const match = addresses.find(x => x.netmask && (ipv4Number(x.address) & ipv4Number(x.netmask)) === (remote & ipv4Number(x.netmask)));
    return (match || addresses[0])?.address || null;
}

module.exports = { parseArtPoll, createArtPollReply, pickLocalIp };

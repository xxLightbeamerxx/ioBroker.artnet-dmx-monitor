'use strict';

/** Parse ArtDMX per Art-Net: header, LE opcode, BE protocol and length. */
function parseArtDmx(message) {
    if (!Buffer.isBuffer(message) || message.length < 18) return null;
    if (message.toString('ascii', 0, 8) !== 'Art-Net\0') return null;
    if (message.readUInt16LE(8) !== 0x5000) return null;
    if (message.readUInt16BE(10) < 14) return null;
    const length = message.readUInt16BE(16);
    if (length < 2 || length > 512 || (length % 2 !== 0) || message.length < 18 + length) return null;
    return {
        sequence: message[12],
        physical: message[13],
        universe: message.readUInt16LE(14),
        data: message.subarray(18, 18 + length),
    };
}
module.exports = { parseArtDmx };

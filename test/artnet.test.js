'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArtDmx } = require('../lib/artnet');
function packet(universe = 0, values = [255, 128]) {
    const data = Buffer.alloc(18 + values.length);
    data.write('Art-Net\0', 0, 'ascii');
    data.writeUInt16LE(0x5000, 8);
    data.writeUInt16BE(14, 10);
    data.writeUInt16LE(universe, 14);
    data.writeUInt16BE(values.length, 16);
    Buffer.from(values).copy(data, 18);
    return data;
}
test('reads correctly formatted ArtDMX', () => {
    const result = parseArtDmx(packet(258, [5, 10, 20, 30]));
    assert.equal(result.universe, 258);
    assert.deepEqual([...result.data], [5, 10, 20, 30]);
});
test('rejects bad header', () => {
    const p = packet(); p[0] = 0;
    assert.equal(parseArtDmx(p), null);
});
test('rejects incomplete and odd DMX data length', () => {
    assert.equal(parseArtDmx(packet().subarray(0, 19)), null);
    const p = packet(); p.writeUInt16BE(3, 16);
    assert.equal(parseArtDmx(p), null);
});
test('rejects other opcodes', () => {
    const p = packet(); p.writeUInt16LE(0x2000, 8);
    assert.equal(parseArtDmx(p), null);
});

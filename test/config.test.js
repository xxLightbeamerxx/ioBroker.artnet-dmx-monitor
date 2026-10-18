'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { channelId, channelsToRemove, obsoleteUniverses, validateConfig, overlaps } = require('../lib/config');

test('channel ID includes the selected universe', () => {
    assert.equal(channelId(0, 1), '0.channel.001');
    assert.equal(channelId(5, 512), '5.channel.512');
});

test('512 -> 32 removes only the remaining 480 channel objects in the selected universe', () => {
    const ns = 'artnet-dmx-monitor.0';
    const ids = Array.from({ length: 512 }, (_, i) => `${ns}.0.channel.${String(i + 1).padStart(3, '0')}`);
    const removed = channelsToRemove([...ids, `${ns}.info.connection`, 'artnet-recorder.0.0.channel.512'], ns, 0, 1, 32);
    assert.equal(removed.length, 480);
    assert.equal(removed[0], `${ns}.0.channel.033`);
    assert.equal(removed.at(-1), `${ns}.0.channel.512`);
});

test('changing the first channel removes states outside both ends of the range', () => {
    assert.deepEqual(channelsToRemove(['x.0.4.channel.001', 'x.0.4.channel.002', 'x.0.4.channel.003', 'x.0.4.channel.004'], 'x.0', 4, 2, 2), ['x.0.4.channel.001', 'x.0.4.channel.004']);
});

test('configuration limits channels to the physical maximum of 512', () => {
    assert.equal(validateConfig({ channelCount: 32 }).channelCount, 32);
    assert.throws(() => validateConfig({ startChannel: 500, channelCount: 32 }));
});

test('detects overlapping addresses on the same UDP port', () => {
    assert.equal(overlaps('0.0.0.0', 6454, '192.168.1.2', 6454), true);
    assert.equal(overlaps('192.168.1.1', 6454, '192.168.1.2', 6454), false);
    assert.equal(overlaps('0.0.0.0', 6454, '0.0.0.0', 6455), false);
});

test('channel cleanup preserves info states, other universes, and other adapters', () => {
    const ns = 'artnet-dmx-monitor.0';
    const ids = [`${ns}.0.channel.032`, `${ns}.0.channel.033`, `${ns}.0.channel.512`, `${ns}.info.connection`, `${ns}.0.channel.custom`, `${ns}.5.channel.512`, 'artnet-recorder.0.0.channel.512'];
    assert.deepEqual(channelsToRemove(ids, ns, 0, 1, 32), [`${ns}.0.channel.033`, `${ns}.0.channel.512`]);
});

test('channel cleanup supports first channel 481 with 32 channels', () => {
    const ns = 'artnet-dmx-monitor.0';
    const ids = Array.from({ length: 512 }, (_, i) => `${ns}.7.channel.${String(i + 1).padStart(3, '0')}`);
    const removed = channelsToRemove(ids, ns, 7, 481, 32);
    assert.equal(removed.length, 480);
    assert.ok(!removed.includes(`${ns}.7.channel.481`));
    assert.ok(removed.includes(`${ns}.7.channel.480`));
});

test('obsolete universe detection only selects other universe branches', () => {
    const ns = 'artnet-dmx-monitor.0';
    const ids = [`${ns}.0`, `${ns}.0.channel`, `${ns}.5`, `${ns}.5.channel`, `${ns}.12.channel`, `${ns}.info`, 'artnet-recorder.0.42.channel', `${ns}.32768.channel`];
    assert.deepEqual(obsoleteUniverses(ids, ns, 5), ['0', '12']);
});

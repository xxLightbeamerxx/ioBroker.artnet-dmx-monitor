'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

// Fake only the ioBroker adapter-core constructor; do not start a live UDP listener.
function loadWithAdapterStub() {
    const originalLoad = Module._load;
    class StubAdapter {
        constructor() {
            // The adapter-core field must never be repurposed for DMX reception.
            this.connected = true;
            this.states = [];
        }
        on() {}
        setState(id, value) { this.states.push({ id, value }); }
    }
    try {
        Module._load = function (request, parent, isMain) {
            if (request === '@iobroker/adapter-core') return { Adapter: StubAdapter };
            return originalLoad.call(this, request, parent, isMain);
        };
        const mainPath = path.resolve(__dirname, '..', 'main.js');
        delete require.cache[mainPath];
        return require(mainPath);
    } finally {
        Module._load = originalLoad;
    }
}

test('DMX receive timeout never overwrites adapter-core connected property', () => {
    const makeAdapter = loadWithAdapterStub();
    const adapter = makeAdapter();
    adapter.timeoutMs = 10000;
    adapter.lastSeenAt = Date.now();
    adapter.updateHealth();
    assert.equal(adapter.connected, true);
    assert.equal(adapter.dmxReceiving, true);
    adapter.lastSeenAt = Date.now() - 11000;
    adapter.updateHealth();
    assert.equal(adapter.connected, true);
    assert.equal(adapter.dmxReceiving, false);
    assert.deepEqual(adapter.states.filter(entry => entry.id === 'info.receiving').map(entry => entry.value.val), [true, false]);
});

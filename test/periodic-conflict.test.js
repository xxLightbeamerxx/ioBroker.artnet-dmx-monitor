'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Structural regression test: conflict scanning must never touch the UDP socket.
test('periodic conflict check remains metadata-only and runs every 10 minutes', () => {
    const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const method = main.split('async checkConfiguredPortConflicts() {')[1].split('\n    async onReady()')[0];
    assert.match(method, /getObjectViewAsync\('system', 'instance'/);
    assert.doesNotMatch(method, /this\.socket|dgram\.|\.bind\(|\.close\(/);
    assert.match(main, /10 \* 60 \* 1000/);
    assert.match(main, /clearInterval\(this\.conflictTimer\)/);
    assert.doesNotMatch(main, /Disable the recorder\/other instance/);
});

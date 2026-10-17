'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('DMX timeout updates receiving without changing UDP listener readiness', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const health = source.split('updateHealth() {')[1].split('\n    }')[0];
  assert.match(health, /setState\('info\.receiving'/);
  assert.doesNotMatch(health, /setState\('info\.connection'/);
  assert.match(source, /this\.socket\.on\('listening'/);
});

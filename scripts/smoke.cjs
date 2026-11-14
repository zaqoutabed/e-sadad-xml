// Checks that the built package loads with require() (CommonJS / plain JavaScript).
const assert = require('node:assert');
const lib = require('../dist/index.js');
const { createEsadadRouter } = require('../dist/express.js');

for (const name of [
  'EsadadService',
  'EsadadError',
  'InMemoryStore',
  'signMessage',
  'verifyMessage',
  'normalizeMobileNumber',
  'formatAmount',
  'requestAvailability',
]) {
  assert.ok(lib[name], `missing export ${name}`);
}
assert.strictEqual(typeof createEsadadRouter, 'function');
assert.strictEqual(lib.formatAmount(10, 'JOD'), '10.000');
assert.strictEqual(lib.normalizeMobileNumber('970599123456'), '0599123456');
console.log('CommonJS smoke test passed');

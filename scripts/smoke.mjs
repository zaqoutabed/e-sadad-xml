// Checks that the built package loads with import (ES modules).
import assert from 'node:assert';
import { EsadadService, formatAmount, MessageTypes } from '../dist/index.mjs';
import { createEsadadRouter } from '../dist/express.mjs';

assert.strictEqual(typeof EsadadService, 'function');
assert.strictEqual(typeof createEsadadRouter, 'function');
assert.strictEqual(formatAmount(5.5, 'ILS'), '5.50');
assert.strictEqual(MessageTypes.PREPAID_VALIDATION_RESPONSE, 'BILRPREPADVALRS');
console.log('ESM smoke test passed');

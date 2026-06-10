import { serializeError } from '../dist/opencode/client.js';
import assert from 'assert';

console.log('Running serializeError tests...\n');

// Test 1: Error instance
const error1 = new Error('Something went wrong');
assert.strictEqual(serializeError(error1), 'Something went wrong', 'Test 1 failed: Error instance');
console.log('✓ Test 1: Error instance with message');

// Test 2: Error instance without message
const error2 = new Error();
assert.strictEqual(serializeError(error2), 'Error', 'Test 2 failed: Error without message');
console.log('✓ Test 2: Error instance without message');

// Test 3: Object with message property
const error3 = { message: 'Object error message', code: 500 };
assert.strictEqual(serializeError(error3), 'Object error message', 'Test 3 failed: Object with message');
console.log('✓ Test 3: Object with message property');

// Test 4: Object with error property (string)
const error4 = { error: 'String error detail' };
assert.strictEqual(serializeError(error4), 'String error detail', 'Test 4 failed: Object with error string');
console.log('✓ Test 4: Object with error property (string)');

// Test 5: Object with error property (object)
const error5 = { error: { detail: 'Nested error' } };
assert.strictEqual(serializeError(error5), '{"detail":"Nested error"}', 'Test 5 failed: Object with error object');
console.log('✓ Test 5: Object with error property (object)');

// Test 6: Object with detail property
const error6 = { detail: 'Detail error message' };
assert.strictEqual(serializeError(error6), 'Detail error message', 'Test 6 failed: Object with detail');
console.log('✓ Test 6: Object with detail property');

// Test 7: Object with statusText property
const error7 = { statusText: 'Not Found' };
assert.strictEqual(serializeError(error7), 'Not Found', 'Test 7 failed: Object with statusText');
console.log('✓ Test 7: Object with statusText property');

// Test 8: Plain object (should JSON.stringify)
const error8 = { foo: 'bar' };
assert.strictEqual(serializeError(error8), '{"foo":"bar"}', 'Test 8 failed: Plain object');
console.log('✓ Test 8: Plain object');

// Test 9: String error
assert.strictEqual(serializeError('string error'), 'string error', 'Test 9 failed: String error');
console.log('✓ Test 9: String error');

// Test 10: Number error
assert.strictEqual(serializeError(404), '404', 'Test 10 failed: Number error');
console.log('✓ Test 10: Number error');

// Test 11: null
assert.strictEqual(serializeError(null), 'null', 'Test 11 failed: null');
console.log('✓ Test 11: null');

// Test 12: undefined
assert.strictEqual(serializeError(undefined), 'undefined', 'Test 12 failed: undefined');
console.log('✓ Test 12: undefined');

// Test 13: Empty object (returns {} via JSON.stringify - this is expected)
const error13 = {};
const result13 = serializeError(error13);
assert.strictEqual(result13, '{}', 'Test 13 failed: Empty object returns {}');
console.log('✓ Test 13: Empty object');

// Test 14: The original bug - Error object should not serialize to {}
const error14 = new Error('Directory not found: /home/neomei/...');
const result14 = serializeError(error14);
assert.notStrictEqual(result14, '{}', 'Test 14 failed: Error should NOT serialize to {}');
assert.ok(result14.includes('Directory not found'), 'Test 14 failed: Error message should be preserved');
console.log('✓ Test 14: Original bug fix - Error does NOT serialize to {}');

console.log('\n✅ All tests passed!');

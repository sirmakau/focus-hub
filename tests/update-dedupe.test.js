import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isDuplicateUpdate,
  resetUpdateDedupe,
} from '../src/bot/update-dedupe.js';

test.beforeEach(() => resetUpdateDedupe());

test('an unseen update id is not a duplicate', () => {
  assert.equal(isDuplicateUpdate(1), false);
});

test('a repeated update id is a duplicate', () => {
  assert.equal(isDuplicateUpdate(42), false);
  assert.equal(isDuplicateUpdate(42), true);
  assert.equal(isDuplicateUpdate(42), true);
});

test('different update ids are independent', () => {
  assert.equal(isDuplicateUpdate(1), false);
  assert.equal(isDuplicateUpdate(2), false);
  assert.equal(isDuplicateUpdate(1), true);
});

test('updates without an id are never treated as duplicates', () => {
  assert.equal(isDuplicateUpdate(undefined), false);
  assert.equal(isDuplicateUpdate(null), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeComboboxLocators } from '../../lib/test-sanitizers.ts';

test('replaces option-text combobox names with an existing stable data-test', () => {
  const source = `
const visible = page.locator('[data-test="product-sort-container"]');
const sort = page.getByRole('combobox', { name: 'Name (A to Z) Name (Z to A) Price (low to high) Price (high to low)' });
await sort.selectOption('Name (Z to A)');`;
  const fixed = sanitizeComboboxLocators(source);
  assert.match(fixed, /page\.locator\("\[data-test=\\"product-sort-container\\"\]"\)/);
  assert.doesNotMatch(fixed, /getByRole\('combobox'/);
});

test('preserves a legitimate short combobox label', () => {
  const source = `page.getByRole('combobox', { name: 'Country' })`;
  assert.equal(sanitizeComboboxLocators(source), source);
});

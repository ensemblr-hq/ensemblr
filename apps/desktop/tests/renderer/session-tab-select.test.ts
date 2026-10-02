import { describe, expect, test } from 'vitest';
import { shouldSelectOnTabClick } from '../../src/renderer/state/workspace/session-tab-select';

const POINTER_CLICK_DETAIL = 1;
const KEYBOARD_ACTIVATION_DETAIL = 0;

describe('shouldSelectOnTabClick', () => {
	test('selects on a plain pointer click with no preceding drag', () => {
		expect(shouldSelectOnTabClick(false, POINTER_CLICK_DETAIL)).toBe(true);
	});

	test('ignores the synthesized pointer click that follows a drag', () => {
		expect(shouldSelectOnTabClick(true, POINTER_CLICK_DETAIL)).toBe(false);
	});

	test('selects on keyboard activation even when a stale drag flag is set', () => {
		expect(shouldSelectOnTabClick(true, KEYBOARD_ACTIVATION_DETAIL)).toBe(true);
	});

	test('selects on keyboard activation with no preceding drag', () => {
		expect(shouldSelectOnTabClick(false, KEYBOARD_ACTIVATION_DETAIL)).toBe(
			true,
		);
	});
});

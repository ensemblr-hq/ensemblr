// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { useDebouncedSettingField } from '../../src/renderer/hooks/use-debounced-setting-field';

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

test('commits the typed value once the debounce elapses', () => {
	const commit = vi.fn((next: string) => next.trim());
	const { result } = renderHook(() =>
		useDebouncedSettingField('', commit, 500),
	);

	act(() => result.current.onChange('origin/main'));
	expect(commit).not.toHaveBeenCalled();

	act(() => vi.advanceTimersByTime(500));
	expect(commit).toHaveBeenCalledExactlyOnceWith('origin/main');
	expect(result.current.value).toBe('origin/main');
});

test('collapses rapid edits into a single commit', () => {
	const commit = vi.fn((next: string) => next);
	const { result } = renderHook(() =>
		useDebouncedSettingField('', commit, 500),
	);

	act(() => result.current.onChange('a'));
	act(() => vi.advanceTimersByTime(200));
	act(() => result.current.onChange('ab'));
	act(() => vi.advanceTimersByTime(500));

	expect(commit).toHaveBeenCalledExactlyOnceWith('ab');
});

test('the just-saved echo does not reset in-progress typing', () => {
	const commit = vi.fn((next: string) => next.trim());
	const { result, rerender } = renderHook(
		({ seed }) => useDebouncedSettingField(seed, commit, 500),
		{ initialProps: { seed: '' } },
	);

	act(() => result.current.onChange('origin/main'));
	act(() => vi.advanceTimersByTime(500));

	rerender({ seed: 'origin/main' });
	expect(result.current.value).toBe('origin/main');

	act(() => result.current.onChange('origin/main-x'));
	rerender({ seed: 'origin/main' });
	expect(result.current.value).toBe('origin/main-x');
});

test('an external seed change re-seeds the field', () => {
	const commit = vi.fn((next: string) => next);
	const { result, rerender } = renderHook(
		({ seed }) => useDebouncedSettingField(seed, commit, 500),
		{ initialProps: { seed: 'origin/main' } },
	);

	rerender({ seed: 'origin/dev' });
	expect(result.current.value).toBe('origin/dev');
});

test('unmounting cancels a pending commit', () => {
	const commit = vi.fn((next: string) => next);
	const { result, unmount } = renderHook(() =>
		useDebouncedSettingField('', commit, 500),
	);

	act(() => result.current.onChange('draft'));
	unmount();
	act(() => vi.advanceTimersByTime(500));

	expect(commit).not.toHaveBeenCalled();
});

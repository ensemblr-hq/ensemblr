// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useFileTreeExpansion } from '@/renderer/hooks/workbench-shell/review-files/use-file-tree-expansion';

const PATHS = ['src', 'src/main', 'src/main/storage', 'docs', 'tests'];

describe('useFileTreeExpansion: revealOnly', () => {
	// A diagram node pointing at one directory in a tree of hundreds is only
	// useful if that directory is the one thing left open when the user arrives.
	it('closes every other directory in a default-closed tree', () => {
		const { result } = renderHook(() => useFileTreeExpansion(false, PATHS));

		act(() => result.current.expandDirectories(['docs', 'tests']));
		expect(result.current.isExpanded('docs')).toBe(true);

		act(() => result.current.revealOnly(['src', 'src/main']));

		expect(result.current.isExpanded('src')).toBe(true);
		expect(result.current.isExpanded('src/main')).toBe(true);
		expect(result.current.isExpanded('docs')).toBe(false);
		expect(result.current.isExpanded('tests')).toBe(false);
		expect(result.current.isExpanded('src/main/storage')).toBe(false);
	});

	// The hook stores paths toggled *away from* the default, so a default-open
	// tree has to invert: everything but the revealed chain becomes collapsed.
	it('closes every other directory in a default-open tree', () => {
		const { result } = renderHook(() => useFileTreeExpansion(true, PATHS));

		act(() => result.current.revealOnly(['src', 'src/main']));

		expect(result.current.isExpanded('src')).toBe(true);
		expect(result.current.isExpanded('src/main')).toBe(true);
		expect(result.current.isExpanded('docs')).toBe(false);
		expect(result.current.isExpanded('src/main/storage')).toBe(false);
	});

	it('leaves the user’s own expansion alone when only expanding', () => {
		const { result } = renderHook(() => useFileTreeExpansion(false, PATHS));

		act(() => result.current.expandDirectories(['docs']));
		act(() => result.current.expandDirectories(['src']));

		expect(result.current.isExpanded('docs')).toBe(true);
		expect(result.current.isExpanded('src')).toBe(true);
	});
});

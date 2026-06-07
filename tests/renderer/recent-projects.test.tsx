import { expect, test } from 'bun:test';

import {
	MAX_RECENT_PROJECTS,
	recordRecentProject,
	removeRecentProject,
} from '../../src/renderer/state/recents';
import type { RecentProject } from '../../src/renderer/types/workbench';

function makeRecent(
	path: string,
	lastOpenedAt = '2026-06-07T00:00:00.000Z',
): RecentProject {
	return { lastOpenedAt, name: path.split('/').pop(), path };
}

test('moves a newly opened project to the front', () => {
	const recents = [makeRecent('~/a'), makeRecent('~/b')];
	const next = recordRecentProject(recents, makeRecent('~/c'));

	expect(next.map((recent) => recent.path)).toEqual(['~/c', '~/a', '~/b']);
});

test('de-duplicates by path and promotes the re-opened project', () => {
	const recents = [makeRecent('~/a'), makeRecent('~/b'), makeRecent('~/c')];
	const reopened = makeRecent('~/c', '2026-06-08T00:00:00.000Z');
	const next = recordRecentProject(recents, reopened);

	expect(next.map((recent) => recent.path)).toEqual(['~/c', '~/a', '~/b']);
	expect(next[0]?.lastOpenedAt).toBe('2026-06-08T00:00:00.000Z');
});

test('caps the recents list at the maximum length', () => {
	const recents = Array.from({ length: MAX_RECENT_PROJECTS }, (_value, index) =>
		makeRecent(`~/p${index}`),
	);
	const next = recordRecentProject(recents, makeRecent('~/new'));

	expect(next).toHaveLength(MAX_RECENT_PROJECTS);
	expect(next[0]?.path).toBe('~/new');
	expect(next.map((recent) => recent.path)).not.toContain(
		`~/p${MAX_RECENT_PROJECTS - 1}`,
	);
});

test('never mutates the input list', () => {
	const recents = [makeRecent('~/a'), makeRecent('~/b')];
	const snapshot = [...recents];

	recordRecentProject(recents, makeRecent('~/c'));
	removeRecentProject(recents, '~/a');

	expect(recents).toEqual(snapshot);
});

test('removes a project by path', () => {
	const recents = [makeRecent('~/a'), makeRecent('~/b'), makeRecent('~/c')];
	const next = removeRecentProject(recents, '~/b');

	expect(next.map((recent) => recent.path)).toEqual(['~/a', '~/c']);
});

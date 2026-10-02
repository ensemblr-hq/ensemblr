import { expect, test } from 'vitest';

import { parseWorkspaceCommits } from '../../src/main/workspace-git/workspace-git-parsers';

const FIELD = '\x1f';
const RECORD = '\x1e';

/** Builds one `git log --pretty=format` record (no trailing newline). */
function record(fields: {
	author: string;
	hash: string;
	isoDate: string;
	relativeTime: string;
	shortHash: string;
	subject: string;
}): string {
	return (
		[
			fields.hash,
			fields.shortHash,
			fields.author,
			fields.isoDate,
			fields.relativeTime,
			fields.subject,
		].join(FIELD) + RECORD
	);
}

test('parses newline-joined commit records newest-first', () => {
	const stdout = [
		record({
			author: 'Ada Lovelace',
			hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
			isoDate: '2026-06-17T09:00:00+02:00',
			relativeTime: '2 hours ago',
			shortHash: 'aaaaaaa',
			subject: 'feat(changes): live commit menu',
		}),
		record({
			author: 'Grace Hopper',
			hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
			isoDate: '2026-06-16T18:00:00+02:00',
			relativeTime: '17 hours ago',
			shortHash: 'bbbbbbb',
			subject: 'fix: off-by-one',
		}),
	].join('\n');

	const commits = parseWorkspaceCommits(stdout);

	expect(commits).toHaveLength(2);
	expect(commits[0]).toEqual({
		author: 'Ada Lovelace',
		hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		isoDate: '2026-06-17T09:00:00+02:00',
		relativeTime: '2 hours ago',
		shortHash: 'aaaaaaa',
		subject: 'feat(changes): live commit menu',
	});
	expect(commits[1]?.subject).toBe('fix: off-by-one');
});

test('subjects containing dashes and unicode survive intact', () => {
	const stdout = record({
		author: 'Tëst Authør',
		hash: 'c'.repeat(40),
		isoDate: '2026-06-15T00:00:00+02:00',
		relativeTime: '2 days ago',
		shortHash: 'ccccccc',
		subject: 'refactor: rename a-b-c → x/y/z • done',
	});

	const [commit] = parseWorkspaceCommits(stdout);

	expect(commit?.subject).toBe('refactor: rename a-b-c → x/y/z • done');
	expect(commit?.author).toBe('Tëst Authør');
});

test('empty output and blank records yield no commits', () => {
	expect(parseWorkspaceCommits('')).toEqual([]);
	expect(parseWorkspaceCommits('\n')).toEqual([]);
	expect(parseWorkspaceCommits(RECORD)).toEqual([]);
});

test('records missing fields are skipped, not partially emitted', () => {
	const incomplete = `onlyhash${FIELD}short${RECORD}`;
	expect(parseWorkspaceCommits(incomplete)).toEqual([]);
});

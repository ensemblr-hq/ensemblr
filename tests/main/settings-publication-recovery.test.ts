import assert from 'node:assert/strict';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { onTestFinished, test } from 'vitest';

import {
	createSettingsPublicationRecoveryStore,
	type StoredSettingsPublicationRecovery,
} from '../../src/main/config/settings-publication-recovery.ts';

const REPOSITORY_ID = 'repo-1';

/** Builds one durable record with payload bytes on every captured copy. */
function record(
	id: string,
	overrides: Partial<StoredSettingsPublicationRecovery> = {},
): StoredSettingsPublicationRecovery {
	const captured = {
		bytesBase64: Buffer.from('[scripts]\nsetup = "x"\n').toString('base64'),
		exists: true,
		hash: `hash-${id}`,
	};
	const fingerprint = {
		fileHash: `hash-${id}`,
		head: 'abc',
		indexEntry: '',
		status: ' M .ensemblr/settings.toml',
	};
	return {
		appliedAt: '2026-09-12T10:00:00.000Z',
		base: captured,
		cleanedAt: null,
		destination: captured,
		destinationApplied: captured,
		destinationGit: fingerprint,
		id,
		repositoryId: REPOSITORY_ID,
		source: captured,
		sourceAfterCleanup: null,
		sourceGit: fingerprint,
		version: 1,
		workspaceId: 'workspace-1',
		...overrides,
	};
}

/** Creates a store over one disposable directory. */
function createStore() {
	const directory = path.join(
		mkdtempSync(path.join(tmpdir(), 'ensemblr-recovery-')),
		'recovery',
	);
	onTestFinished(() => {
		rmSync(path.dirname(directory), { force: true, recursive: true });
	});
	return {
		directory,
		store: createSettingsPublicationRecoveryStore(directory),
	};
}

test('lists recoveries from summaries without reading stored payloads', () => {
	const { directory, store } = createStore();
	store.write(record('aaaa'));
	store.write(record('bbbb', { repositoryId: 'repo-2' }));

	const summaryPath = path.join(directory, 'aaaa.summary.json');
	assert.equal(existsSync(summaryPath), true);
	assert.equal(
		readFileSync(summaryPath, 'utf8').includes('bytesBase64'),
		false,
	);
	assert.deepEqual(
		store.list(REPOSITORY_ID).map((entry) => entry.id),
		['aaaa'],
	);
	assert.equal(store.read('aaaa')?.source.bytesBase64 !== null, true);
});

test('lists a record written before summaries existed', () => {
	const { directory, store } = createStore();
	store.write(record('cccc'));
	unlinkSync(path.join(directory, 'cccc.summary.json'));
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		path.join(directory, 'dddd.json'),
		JSON.stringify(record('dddd')),
		'utf8',
	);

	const listed = store.list(REPOSITORY_ID).map((entry) => entry.id);

	assert.deepEqual(listed.sort(), ['cccc', 'dddd']);
	assert.equal(store.read('dddd')?.workspaceId, 'workspace-1');
});

test('keeps stored recovery files user-only', () => {
	const { directory, store } = createStore();
	store.write(record('eeee'));

	assert.equal(statSync(directory).mode & 0o777, 0o700);
	assert.equal(statSync(path.join(directory, 'eeee.json')).mode & 0o777, 0o600);
	assert.equal(
		statSync(path.join(directory, 'eeee.summary.json')).mode & 0o777,
		0o600,
	);
});

test('replaces the summary as the record advances through cleanup', () => {
	const { store } = createStore();
	store.write(record('ffff'));
	store.write(record('ffff', { cleanedAt: '2026-09-12T11:00:00.000Z' }));

	assert.equal(
		store.list(REPOSITORY_ID).at(0)?.cleanedAt,
		'2026-09-12T11:00:00.000Z',
	);
});

test('ignores malformed documents rather than failing the listing', () => {
	const { directory, store } = createStore();
	store.write(record('abcd'));
	mkdirSync(directory, { recursive: true });
	writeFileSync(path.join(directory, 'beef.json'), 'not json', 'utf8');
	writeFileSync(path.join(directory, 'notes.txt'), 'ignored', 'utf8');

	assert.deepEqual(
		store.list(REPOSITORY_ID).map((entry) => entry.id),
		['abcd'],
	);
	assert.equal(store.read('beef'), null);
});

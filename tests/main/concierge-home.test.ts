import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import {
	conciergeMemoryPath,
	ensureConciergeHome,
	resolveConciergeHome,
} from '../../src/main/concierge/concierge-home.ts';

const created: string[] = [];

function tempRoot(): string {
	const directory = mkdtempSync(
		path.join(tmpdir(), 'ensemblr-concierge-home-'),
	);
	created.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of created.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe('the Concierge home', () => {
	test('creates its directories and seeds the memory index', () => {
		const conciergePath = path.join(tempRoot(), 'concierge');

		const home = ensureConciergeHome(conciergePath);

		expect(home.rootPath).toBe(conciergePath);
		expect(home.memoryPath).toBe(path.join(conciergePath, 'memory'));
		expect(home.artifactsPath).toBe(path.join(conciergePath, 'artifacts'));
		expect(readFileSync(home.memoryIndexPath, 'utf8')).toContain(
			'# Memory Index',
		);
	});

	test('leaves an existing memory index alone on a second launch', () => {
		const conciergePath = path.join(tempRoot(), 'concierge');
		const home = ensureConciergeHome(conciergePath);
		writeFileSync(home.memoryIndexPath, '# Mine\n', 'utf8');

		ensureConciergeHome(conciergePath);

		expect(readFileSync(home.memoryIndexPath, 'utf8')).toBe('# Mine\n');
	});

	test('names a memory file after its slug', () => {
		const home = resolveConciergeHome('/root/concierge');

		expect(conciergeMemoryPath(home, 'bruckner-storage')).toBe(
			path.join('/root/concierge/memory', 'bruckner-storage.md'),
		);
	});
});

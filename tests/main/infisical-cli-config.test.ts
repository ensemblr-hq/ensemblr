import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { readInfisicalCliConfig } from '../../src/main/infisical/infisical-cli-config';

let repositoryPath: string;

/** Writes a `.infisical.json` with the given raw contents. */
function writeCliConfig(contents: string): void {
	writeFileSync(path.join(repositoryPath, '.infisical.json'), contents, 'utf8');
}

beforeEach(() => {
	repositoryPath = mkdtempSync(path.join(tmpdir(), 'infisical-cli-'));
});

afterEach(() => {
	rmSync(repositoryPath, { force: true, recursive: true });
});

describe('readInfisicalCliConfig', () => {
	test('reads the project and environment the CLI wrote', () => {
		writeCliConfig(
			JSON.stringify({
				defaultEnvironment: 'dev',
				gitBranchToEnvironmentMapping: null,
				workspaceId: '61e1048b-1399-4657-864b-00d4613698da',
			}),
		);

		expect(readInfisicalCliConfig(repositoryPath)).toEqual({
			environmentSlug: 'dev',
			projectId: '61e1048b-1399-4657-864b-00d4613698da',
			siteUrl: null,
		});
	});

	test('reports no environment when the CLI left defaultEnvironment blank', () => {
		writeCliConfig(
			JSON.stringify({
				defaultEnvironment: '',
				gitBranchToEnvironmentMapping: null,
				workspaceId: 'proj_1',
			}),
		);

		expect(readInfisicalCliConfig(repositoryPath)).toEqual({
			environmentSlug: null,
			projectId: 'proj_1',
			siteUrl: null,
		});
	});

	test('reports no environment when defaultEnvironment is absent entirely', () => {
		writeCliConfig(JSON.stringify({ workspaceId: 'proj_1' }));

		expect(readInfisicalCliConfig(repositoryPath)?.environmentSlug).toBeNull();
	});

	test('trims surrounding whitespace off both values', () => {
		writeCliConfig(
			JSON.stringify({ defaultEnvironment: ' dev ', workspaceId: ' proj_1 ' }),
		);

		expect(readInfisicalCliConfig(repositoryPath)).toEqual({
			environmentSlug: 'dev',
			projectId: 'proj_1',
			siteUrl: null,
		});
	});

	test('reads the self-hosted instance the CLI recorded as domain', () => {
		writeCliConfig(
			JSON.stringify({
				defaultEnvironment: 'dev',
				domain: 'https://infisical.acme.internal/api',
				workspaceId: 'proj_1',
			}),
		);

		expect(readInfisicalCliConfig(repositoryPath)?.siteUrl).toBe(
			'https://infisical.acme.internal/api',
		);
	});

	test('reports no instance when the CLI wrote a blank domain', () => {
		writeCliConfig(JSON.stringify({ domain: '   ', workspaceId: 'proj_1' }));

		expect(readInfisicalCliConfig(repositoryPath)?.siteUrl).toBeNull();
	});

	test('ignores a file that names no project', () => {
		writeCliConfig(JSON.stringify({ defaultEnvironment: 'dev' }));

		expect(readInfisicalCliConfig(repositoryPath)).toBeNull();
	});

	test('ignores a non-string project id', () => {
		writeCliConfig(JSON.stringify({ workspaceId: 42 }));

		expect(readInfisicalCliConfig(repositoryPath)).toBeNull();
	});

	test('ignores malformed JSON rather than throwing', () => {
		writeCliConfig('{ "workspaceId": ');

		expect(readInfisicalCliConfig(repositoryPath)).toBeNull();
	});

	test('ignores a top level that is not an object', () => {
		writeCliConfig(JSON.stringify(['proj_1']));

		expect(readInfisicalCliConfig(repositoryPath)).toBeNull();
	});

	test('reports nothing when the repository has no such file', () => {
		expect(readInfisicalCliConfig(repositoryPath)).toBeNull();
	});
});

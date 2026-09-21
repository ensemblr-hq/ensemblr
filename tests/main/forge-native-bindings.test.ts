import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('node:child_process', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:child_process')>()),
	execFile: vi.fn(() => {
		throw new Error('Tests must not execute external signing commands');
	}),
}));

vi.stubEnv('ENSEMBLR_BUILD_CHANNEL', 'release');
vi.stubEnv('ENSEMBLR_REQUIRE_SIGN', '');
vi.stubEnv('ENSEMBLR_SKIP_SIGN', '1');

afterAll(() => vi.unstubAllEnvs());

const { default: config } = await import('../../forge.config.ts');

const roots: string[] = [];

function macho(arch: 'arm64' | 'x64'): Buffer {
	const bytes = Buffer.alloc(64);
	bytes.writeUInt32LE(0xfeedfacf, 0);
	bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
	return bytes;
}

function binding(root: string, relativePath: string, arch: 'arm64' | 'x64') {
	const path = join(root, relativePath);
	mkdirSync(join(path, '..'), { recursive: true });
	writeFileSync(path, macho(arch));
}

function packageRoot(): string {
	const root = mkdtempSync(join(tmpdir(), 'ensemblr-forge-native-'));
	roots.push(root);
	return root;
}

function postPackage() {
	const hook = config.hooks?.postPackage;
	if (typeof hook !== 'function')
		throw new Error('postPackage hook is missing');
	return hook;
}

const resolvedConfig = config as Parameters<ReturnType<typeof postPackage>>[0];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

test('the unsigned postMake hook returns artifacts unchanged without signing', async () => {
	const hook = config.hooks?.postMake;
	if (typeof hook !== 'function') throw new Error('postMake hook is missing');
	const results: Parameters<typeof hook>[1] = [
		{
			artifacts: ['out/make/Ensemblr-x64.dmg', 'out/make/Ensemblr-x64.zip'],
			packageJSON: { name: 'ensemblr', version: '0.0.0' },
			platform: 'darwin',
			arch: 'x64',
		},
	];
	const expected = structuredClone(results);

	await expect(hook(resolvedConfig, results)).resolves.toBe(results);
	expect(results).toEqual(expected);
	expect(execFile).not.toHaveBeenCalled();
});

describe('the Forge native-binding architecture hook', () => {
	test('ignores node-pty bin copies the runtime never loads', async () => {
		const root = packageRoot();
		binding(root, 'node_modules/node-pty/build/Release/pty.node', 'x64');
		binding(
			root,
			'node_modules/node-pty/bin/darwin-arm64-149/node-pty.node',
			'arm64',
		);

		await expect(
			postPackage()(resolvedConfig, {
				arch: 'x64',
				outputPaths: [root],
				platform: 'darwin',
			}),
		).resolves.toBeUndefined();
	});

	test('rejects a wrong architecture in an active binding location', async () => {
		const root = packageRoot();
		binding(root, 'node_modules/node-pty/build/Release/pty.node', 'arm64');

		await expect(
			postPackage()(resolvedConfig, {
				arch: 'x64',
				outputPaths: [root],
				platform: 'darwin',
			}),
		).rejects.toThrow(/build\/Release\/pty\.node is arm64/);
	});
});

import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

const { main } = await import('../../scripts/fetch-appimage-runtime.mjs');

const roots = [];
const originalArgv = [...process.argv];
const originalTargetArch = process.env.ENSEMBLR_TARGET_ARCH;

function runtime(machine = 0x3e) {
	const bytes = Buffer.alloc(64);
	bytes.write('\x7fELF', 0, 'latin1');
	bytes.writeUInt16LE(machine, 18);
	return bytes;
}

function pins(bytes) {
	return new Map([
		[
			'x64',
			{
				name: 'x86_64',
				sha256: createHash('sha256').update(bytes).digest('hex'),
				machine: 0x3e,
			},
		],
	]);
}

function destination() {
	const root = mkdtempSync(join(tmpdir(), 'ensemblr-appimage-runtime-'));
	roots.push(root);
	return join(root, 'runtime-x86_64');
}

afterEach(() => {
	vi.restoreAllMocks();
	process.argv = [...originalArgv];
	if (originalTargetArch === undefined) delete process.env.ENSEMBLR_TARGET_ARCH;
	else process.env.ENSEMBLR_TARGET_ARCH = originalTargetArch;
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe('AppImage runtime preflight', () => {
	test('rejects an unsupported architecture from argv', async () => {
		process.argv = [originalArgv[0], originalArgv[1], '--arch=riscv64'];
		const error = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);

		await expect(main()).resolves.toBe(1);
		expect(error).toHaveBeenCalledWith(
			expect.stringContaining('No pinned AppImage runtime for --arch=riscv64'),
		);
	});

	test('reads the target architecture from the environment without a flag', async () => {
		process.argv = originalArgv.slice(0, 2);
		process.env.ENSEMBLR_TARGET_ARCH = 'riscv64';
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await expect(main()).resolves.toBe(1);
	});

	test('falls back to the host architecture', async () => {
		process.argv = originalArgv.slice(0, 2);
		delete process.env.ENSEMBLR_TARGET_ARCH;
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await expect(main({ runtimes: new Map() })).resolves.toBe(1);
	});

	test('uses a valid cached runtime without downloading it', async () => {
		const path = destination();
		const bytes = runtime();
		writeFileSync(path, bytes);
		const download = vi.fn();

		await expect(
			main({ arch: 'x64', destination: path, download, runtimes: pins(bytes) }),
		).resolves.toBe(0);
		expect(download).not.toHaveBeenCalled();
		expect(
			JSON.parse(readFileSync(join(path, '..', 'resolved.json'), 'utf8')),
		).toEqual({ runtime: path });
	});

	test('removes an invalid cache entry and refetches it', async () => {
		const path = destination();
		const bytes = runtime();
		writeFileSync(path, runtime(0xb7));
		const download = vi.fn().mockResolvedValue(new Response(bytes));
		vi.spyOn(console, 'log').mockImplementation(() => undefined);

		await expect(
			main({ arch: 'x64', destination: path, download, runtimes: pins(bytes) }),
		).resolves.toBe(0);
		expect(download).toHaveBeenCalledOnce();
		expect(readFileSync(path)).toEqual(bytes);
	});

	test('reports an HTTP failure without staging a runtime', async () => {
		const path = destination();
		const bytes = runtime();
		const error = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);
		const download = vi
			.fn()
			.mockResolvedValue(new Response(null, { status: 503 }));

		await expect(
			main({ arch: 'x64', destination: path, download, runtimes: pins(bytes) }),
		).resolves.toBe(1);
		expect(existsSync(path)).toBe(false);
		expect(error).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'));
	});

	test('stages a verified download and records its manifest', async () => {
		const path = destination();
		const bytes = runtime();
		const download = vi.fn().mockResolvedValue(new Response(bytes));
		const resolveDestination = vi.fn().mockReturnValue(path);
		vi.spyOn(console, 'log').mockImplementation(() => undefined);

		await expect(
			main({
				arch: 'x64',
				download,
				resolveDestination,
				runtimes: pins(bytes),
			}),
		).resolves.toBe(0);
		expect(resolveDestination).toHaveBeenCalledWith('x86_64');
		expect(readFileSync(path)).toEqual(bytes);
		expect(statSync(path).mode & 0o777).toBe(0o755);
		expect(
			JSON.parse(readFileSync(join(path, '..', 'resolved.json'), 'utf8')),
		).toEqual({ runtime: path });
	});

	test('rejects a download whose digest differs from the pin', async () => {
		const path = destination();
		const expected = runtime();
		const downloaded = Buffer.from(expected);
		downloaded[32] = 1;
		const error = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);

		await expect(
			main({
				arch: 'x64',
				destination: path,
				download: vi.fn().mockResolvedValue(new Response(downloaded)),
				runtimes: pins(expected),
			}),
		).resolves.toBe(1);
		expect(existsSync(path)).toBe(false);
		expect(error).toHaveBeenCalledWith(
			expect.stringContaining('expected sha256'),
		);
	});

	test('rejects pinned bytes without an ELF header', async () => {
		const path = destination();
		const bytes = Buffer.alloc(64);
		const error = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);

		await expect(
			main({
				arch: 'x64',
				destination: path,
				download: vi.fn().mockResolvedValue(new Response(bytes)),
				runtimes: pins(bytes),
			}),
		).resolves.toBe(1);
		expect(error).toHaveBeenCalledWith(
			expect.stringContaining('not an ELF binary'),
		);
	});

	test('rejects pinned ELF bytes for the wrong machine', async () => {
		const path = destination();
		const bytes = runtime(0xb7);
		const error = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);

		await expect(
			main({
				arch: 'x64',
				destination: path,
				download: vi.fn().mockResolvedValue(new Response(bytes)),
				runtimes: pins(bytes),
			}),
		).resolves.toBe(1);
		expect(error).toHaveBeenCalledWith(
			expect.stringContaining('ELF machine is 0xb7'),
		);
	});
});

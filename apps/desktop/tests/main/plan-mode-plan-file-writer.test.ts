import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	createPlanFileWriter,
	type WritePlanFileInput,
} from '../../src/main/plan-mode/plan-file-writer.ts';

vi.mock('node:fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs/promises')>();
	return { ...actual, readFile: vi.fn(actual.readFile), rm: vi.fn(actual.rm) };
});

const CREATED_AT = new Date('2026-07-28T14:32:07.000Z');

const INPUT = {
	agentSessionId: 'sess-1',
	plan: '# Steps\n\n1. Do the thing',
	title: 'Add Plan Mode',
	workspaceId: 'ws-1',
};

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = async (label: string) => {
	const directory = await mkdtemp(path.join(tmpdir(), `ensemblr-${label}-`));
	temporaryDirectories.push(directory);
	return directory;
};

const makeInput = (
	workspaceCwd: string,
	overrides: Partial<WritePlanFileInput> = {},
): WritePlanFileInput => ({ ...INPUT, workspaceCwd, ...overrides });

const plansDirectory = (workspaceCwd: string) =>
	path.join(workspaceCwd, '.context', 'plans');

const createWriter = (now = CREATED_AT) =>
	createPlanFileWriter({ now: () => now });

/** Local-time stem the injected clock produces, so the test is timezone-proof. */
const stem = (date = CREATED_AT) => {
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(
		date.getDate(),
	)}-${pad(date.getHours())}${pad(date.getMinutes())}`;
};

const legacyPlan = ({
	agentSessionId = INPUT.agentSessionId,
	createdAt,
	title,
	workspaceId = INPUT.workspaceId,
}: {
	agentSessionId?: string;
	createdAt: string;
	title: string;
	workspaceId?: string;
}) => `---
title: ${JSON.stringify(title)}
agentSessionId: ${JSON.stringify(agentSessionId)}
workspaceId: ${JSON.stringify(workspaceId)}
createdAt: ${JSON.stringify(createdAt)}
---

# ${title}

Old body
`;

afterEach(async () => {
	vi.mocked(readFile).mockReset();
	vi.mocked(rm).mockReset();
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

describe('createPlanFileWriter', () => {
	it('writes into .context/plans and returns a workspace-relative path', async () => {
		const workspaceCwd = await makeTemporaryDirectory('plan-writer');
		const relativePath = await createWriter().writePlanFile(
			makeInput(workspaceCwd),
		);

		expect(relativePath).toBe(
			path.join('.context', 'plans', `${stem()}-add-plan-mode.md`),
		);
		expect(await readdir(plansDirectory(workspaceCwd))).toEqual([
			`${stem()}-add-plan-mode.md`,
		]);
	});

	it('records identity in frontmatter and keeps the plan body', async () => {
		const workspaceCwd = await makeTemporaryDirectory('plan-writer');
		const relativePath = await createWriter().writePlanFile(
			makeInput(workspaceCwd),
		);
		const contents = await readFile(
			path.join(workspaceCwd, relativePath),
			'utf8',
		);

		expect(contents).toContain('title: "Add Plan Mode"');
		expect(contents).toContain('agentSessionId: "sess-1"');
		expect(contents).toContain('workspaceId: "ws-1"');
		expect(contents).toContain(`createdAt: "${CREATED_AT.toISOString()}"`);
		expect(contents).toContain('# Add Plan Mode');
		expect(contents).toContain('1. Do the thing');
	});

	it('reuses the original plan file after a restart and preserves its creation time', async () => {
		const workspaceCwd = await makeTemporaryDirectory('plan-writer');
		const originalPath = await createWriter().writePlanFile(
			makeInput(workspaceCwd),
		);
		const refinedPath = await createWriter(
			new Date('2026-07-29T09:15:00.000Z'),
		).writePlanFile(
			makeInput(workspaceCwd, {
				plan: 'Refined steps',
				title: 'A Better Title',
			}),
		);
		const contents = await readFile(
			path.join(workspaceCwd, originalPath),
			'utf8',
		);

		expect(refinedPath).toBe(originalPath);
		expect(await readdir(plansDirectory(workspaceCwd))).toEqual([
			path.basename(originalPath),
		]);
		expect(contents).toContain(`createdAt: "${CREATED_AT.toISOString()}"`);
		expect(contents).toContain('title: "A Better Title"');
		expect(contents).toContain('Refined steps');
		expect(contents).not.toContain('1. Do the thing');
	});

	it('continues saving when a candidate disappears after the directory listing', async () => {
		const workspaceCwd = await makeTemporaryDirectory('plan-writer');
		const writer = createWriter();
		const relativePath = await writer.writePlanFile(makeInput(workspaceCwd));
		const absolutePath = path.join(workspaceCwd, relativePath);
		vi.mocked(readFile).mockImplementationOnce(async () => {
			await rm(absolutePath);
			throw Object.assign(new Error('candidate removed'), { code: 'ENOENT' });
		});

		await expect(
			writer.writePlanFile(makeInput(workspaceCwd, { plan: 'Updated plan' })),
		).resolves.toBe(relativePath);
		expect(await readFile(absolutePath, 'utf8')).toContain('Updated plan');
		expect(await readdir(plansDirectory(workspaceCwd))).toEqual([
			path.basename(relativePath),
		]);
	});

	it.each(['EACCES', 'EPERM', 'EIO'])(
		'rejects %s candidate read failures without creating another plan',
		async (code) => {
			const workspaceCwd = await makeTemporaryDirectory('plan-writer');
			const writer = createWriter();
			const relativePath = await writer.writePlanFile(makeInput(workspaceCwd));
			const absolutePath = path.join(workspaceCwd, relativePath);
			const originalContents = await readFile(absolutePath, 'utf8');
			const error = Object.assign(new Error('candidate unreadable'), { code });
			vi.mocked(readFile).mockRejectedValueOnce(error);

			await expect(
				writer.writePlanFile(makeInput(workspaceCwd, { plan: 'Unsaved plan' })),
			).rejects.toBe(error);
			expect(await readFile(absolutePath, 'utf8')).toBe(originalContents);
			expect(await readdir(plansDirectory(workspaceCwd))).toEqual([
				path.basename(relativePath),
			]);
		},
	);

	it('serializes overlapping writes for the same plan identity', async () => {
		const workspaceCwd = await makeTemporaryDirectory('plan-writer');
		let releaseFirstWrite = () => {};
		let markFirstWriteStarted = () => {};
		const firstWriteBlocked = new Promise<void>((resolve) => {
			releaseFirstWrite = resolve;
		});
		const firstWriteStarted = new Promise<void>((resolve) => {
			markFirstWriteStarted = resolve;
		});
		let writeCount = 0;
		const writer = createPlanFileWriter({
			now: () => CREATED_AT,
			writeFile: async (filePath, contents) => {
				writeCount += 1;
				if (writeCount === 1) {
					markFirstWriteStarted();
					await firstWriteBlocked;
				}
				await writeFile(filePath, contents, { encoding: 'utf8', flag: 'wx' });
			},
		});
		const firstWrite = writer.writePlanFile(
			makeInput(workspaceCwd, { plan: 'First plan' }),
		);
		await firstWriteStarted;
		const secondWrite = writer.writePlanFile(
			makeInput(workspaceCwd, { plan: 'Second plan' }),
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
		releaseFirstWrite();

		const [firstPath, secondPath] = await Promise.all([
			firstWrite,
			secondWrite,
		]);
		const entries = await readdir(plansDirectory(workspaceCwd));

		expect(secondPath).toBe(firstPath);
		expect(entries).toEqual([path.basename(firstPath)]);
		expect(
			await readFile(path.join(workspaceCwd, firstPath), 'utf8'),
		).toContain('Second plan');
	});

	it('does not block writes for different plan identities', async () => {
		const blockedWorkspace = await makeTemporaryDirectory(
			'plan-writer-blocked',
		);
		const otherWorkspace = await makeTemporaryDirectory('plan-writer-other');
		let releaseBlockedWrite = () => {};
		let markBlockedWriteStarted = () => {};
		const blockedWriteGate = new Promise<void>((resolve) => {
			releaseBlockedWrite = resolve;
		});
		const blockedWriteStarted = new Promise<void>((resolve) => {
			markBlockedWriteStarted = resolve;
		});
		const writer = createPlanFileWriter({
			now: () => CREATED_AT,
			writeFile: async (filePath, contents) => {
				if (filePath.startsWith(plansDirectory(blockedWorkspace))) {
					markBlockedWriteStarted();
					await blockedWriteGate;
				}
				await writeFile(filePath, contents, { encoding: 'utf8', flag: 'wx' });
			},
		});
		const blockedWrite = writer.writePlanFile(makeInput(blockedWorkspace));
		await blockedWriteStarted;

		const otherPath = await writer.writePlanFile(
			makeInput(otherWorkspace, {
				agentSessionId: 'sess-2',
				workspaceId: 'ws-2',
			}),
		);
		releaseBlockedWrite();
		await blockedWrite;

		expect(await readdir(plansDirectory(otherWorkspace))).toEqual([
			path.basename(otherPath),
		]);
	});

	it('continues a queued write after the preceding write fails', async () => {
		const workspaceCwd = await makeTemporaryDirectory('plan-writer');
		let releaseFailedWrite = () => {};
		let markFailedWriteStarted = () => {};
		const failedWriteGate = new Promise<void>((resolve) => {
			releaseFailedWrite = resolve;
		});
		const failedWriteStarted = new Promise<void>((resolve) => {
			markFailedWriteStarted = resolve;
		});
		let writeCount = 0;
		const writer = createPlanFileWriter({
			now: () => CREATED_AT,
			writeFile: async (filePath, contents) => {
				writeCount += 1;
				if (writeCount === 1) {
					markFailedWriteStarted();
					await failedWriteGate;
					throw new Error('disk full');
				}
				await writeFile(filePath, contents, { encoding: 'utf8', flag: 'wx' });
			},
		});
		const failedWrite = writer.writePlanFile(makeInput(workspaceCwd));
		await failedWriteStarted;
		const queuedWrite = writer.writePlanFile(
			makeInput(workspaceCwd, { plan: 'Recovered plan' }),
		);
		releaseFailedWrite();

		await expect(failedWrite).rejects.toThrow('disk full');
		const recoveredPath = await queuedWrite;

		expect(
			await readFile(path.join(workspaceCwd, recoveredPath), 'utf8'),
		).toContain('Recovered plan');
	});

	it('suffixes the filename for a different conversation in the same minute', async () => {
		const workspaceCwd = await makeTemporaryDirectory('plan-writer');
		const writer = createWriter();
		await writer.writePlanFile(makeInput(workspaceCwd));

		expect(
			await writer.writePlanFile(
				makeInput(workspaceCwd, { agentSessionId: 'sess-2' }),
			),
		).toBe(path.join('.context', 'plans', `${stem()}-add-plan-mode-2.md`));
	});

	it('updates the earliest legacy duplicate and leaves later duplicates untouched', async () => {
		const workspaceCwd = await makeTemporaryDirectory('plan-writer');
		const directory = plansDirectory(workspaceCwd);
		await mkdir(directory, { recursive: true });
		const originalPath = path.join(directory, '20260728-1000-original.md');
		const duplicatePath = path.join(directory, '20260728-1100-duplicate.md');
		const duplicateContents = legacyPlan({
			createdAt: '2026-07-28T11:00:00.000Z',
			title: 'Duplicate',
		});
		await writeFile(
			originalPath,
			legacyPlan({
				createdAt: '2026-07-28T10:00:00.000Z',
				title: 'Original',
			}),
			'utf8',
		);
		await writeFile(duplicatePath, duplicateContents, 'utf8');

		const relativePath = await createWriter().writePlanFile(
			makeInput(workspaceCwd, { plan: 'Refined', title: 'Current title' }),
		);

		expect(relativePath).toBe(path.relative(workspaceCwd, originalPath));
		expect(await readFile(originalPath, 'utf8')).toContain('Refined');
		expect(await readFile(originalPath, 'utf8')).toContain(
			'createdAt: "2026-07-28T10:00:00.000Z"',
		);
		expect(await readFile(duplicatePath, 'utf8')).toBe(duplicateContents);
	});

	it('selects the earliest plan across multiple read batches', async () => {
		const workspaceCwd = await makeTemporaryDirectory('plan-writer');
		const directory = plansDirectory(workspaceCwd);
		await mkdir(directory, { recursive: true });
		await Promise.all(
			Array.from({ length: 17 }, (_, index) =>
				writeFile(
					path.join(directory, `plan-${String(index).padStart(2, '0')}.md`),
					legacyPlan({
						createdAt: new Date(
							CREATED_AT.getTime() - index * 60_000,
						).toISOString(),
						title: `Plan ${index}`,
					}),
					'utf8',
				),
			),
		);

		const relativePath = await createWriter().writePlanFile(
			makeInput(workspaceCwd, { plan: 'Refined across batches' }),
		);

		expect(relativePath).toBe(path.join('.context', 'plans', 'plan-16.md'));
		expect(await readdir(directory)).toHaveLength(17);
		expect(
			await readFile(path.join(workspaceCwd, relativePath), 'utf8'),
		).toContain('Refined across batches');
	});

	it('returns the saved plan path even when temporary-file cleanup fails', async () => {
		const workspaceCwd = await makeTemporaryDirectory('plan-writer');
		const writer = createWriter();
		const relativePath = await writer.writePlanFile(makeInput(workspaceCwd));
		vi.mocked(rm).mockRejectedValueOnce(
			Object.assign(new Error('cleanup denied'), { code: 'EACCES' }),
		);

		await expect(
			writer.writePlanFile(
				makeInput(workspaceCwd, { plan: 'Saved refinement' }),
			),
		).resolves.toBe(relativePath);
		expect(
			await readFile(path.join(workspaceCwd, relativePath), 'utf8'),
		).toContain('Saved refinement');
		expect(await readdir(plansDirectory(workspaceCwd))).toEqual([
			path.basename(relativePath),
		]);
	});

	it.each([false, true])(
		'preserves the original write failure and plan (cleanup fails: %s)',
		async (cleanupFails) => {
			const workspaceCwd = await makeTemporaryDirectory('plan-writer');
			const relativePath = await createWriter().writePlanFile(
				makeInput(workspaceCwd),
			);
			const absolutePath = path.join(workspaceCwd, relativePath);
			const originalContents = await readFile(absolutePath, 'utf8');
			const failingWriter = createPlanFileWriter({
				writeFile: () => Promise.reject(new Error('disk full')),
			});
			if (cleanupFails) {
				vi.mocked(rm).mockRejectedValueOnce(new Error('cleanup denied'));
			}

			await expect(
				failingWriter.writePlanFile(
					makeInput(workspaceCwd, { plan: 'Unsaved refinement' }),
				),
			).rejects.toThrow('disk full');
			expect(await readFile(absolutePath, 'utf8')).toBe(originalContents);
			expect(rm).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), {
				force: true,
			});
		},
	);

	it('does not follow a colliding plan-file symlink', async () => {
		const workspaceCwd = await makeTemporaryDirectory('plan-writer');
		const victimDirectory = await makeTemporaryDirectory('plan-victim');
		const victimPath = path.join(victimDirectory, 'victim.md');
		await writeFile(victimPath, 'do not replace', 'utf8');
		await mkdir(plansDirectory(workspaceCwd), { recursive: true });
		await symlink(
			victimPath,
			path.join(plansDirectory(workspaceCwd), `${stem()}-add-plan-mode.md`),
		);

		expect(await createWriter().writePlanFile(makeInput(workspaceCwd))).toBe(
			path.join('.context', 'plans', `${stem()}-add-plan-mode-2.md`),
		);
		expect(await readFile(victimPath, 'utf8')).toBe('do not replace');
	});

	it('rejects a plan directory redirected outside the workspace', async () => {
		const workspaceCwd = await makeTemporaryDirectory('plan-writer');
		const externalDirectory = await makeTemporaryDirectory('plan-external');
		await symlink(externalDirectory, path.join(workspaceCwd, '.context'));

		await expect(
			createWriter().writePlanFile(makeInput(workspaceCwd)),
		).rejects.toThrow('Plan directory must stay inside the workspace');
		expect(await readdir(externalDirectory)).toEqual([]);
	});

	it('strips path separators out of a traversing title', async () => {
		const workspaceCwd = await makeTemporaryDirectory('plan-writer');
		const relativePath = await createWriter().writePlanFile(
			makeInput(workspaceCwd, { title: '../../etc/passwd' }),
		);

		expect(relativePath.startsWith(path.join('.context', 'plans'))).toBe(true);
		expect(relativePath).not.toContain('..');
	});

	it('falls back to a generic slug when the title has no usable characters', async () => {
		const workspaceCwd = await makeTemporaryDirectory('plan-writer');

		expect(
			await createWriter().writePlanFile(
				makeInput(workspaceCwd, { title: '!!!' }),
			),
		).toBe(path.join('.context', 'plans', `${stem()}-plan.md`));
	});

	it('caps a very long title so the filename stays usable', async () => {
		const workspaceCwd = await makeTemporaryDirectory('plan-writer');
		const relativePath = await createWriter().writePlanFile(
			makeInput(workspaceCwd, { title: 'a'.repeat(80) }),
		);

		expect(path.basename(relativePath)).toBe(`${stem()}-${'a'.repeat(60)}.md`);
	});
});

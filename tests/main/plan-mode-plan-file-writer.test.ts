import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createPlanFileWriter } from '../../src/main/plan-mode/plan-file-writer.ts';

const WORKSPACE_CWD = '/tmp/workspace';
const CREATED_AT = new Date('2026-07-28T14:32:07.000Z');

const INPUT = {
	agentSessionId: 'sess-1',
	plan: '# Steps\n\n1. Do the thing',
	title: 'Add Plan Mode',
	workspaceCwd: WORKSPACE_CWD,
	workspaceId: 'ws-1',
};

const setup = (existingPaths: readonly string[] = []) => {
	const written: { path: string; contents: string }[] = [];
	const created: string[] = [];
	const writer = createPlanFileWriter({
		exists: (filePath) => Promise.resolve(existingPaths.includes(filePath)),
		mkdir: (dirPath) => {
			created.push(dirPath);
			return Promise.resolve();
		},
		now: () => CREATED_AT,
		writeFile: (filePath, contents) => {
			written.push({ contents, path: filePath });
			return Promise.resolve();
		},
	});
	return { created, writer, written };
};

/** Local-time stem the injected clock produces, so the test is timezone-proof. */
const stem = () => {
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${CREATED_AT.getFullYear()}${pad(CREATED_AT.getMonth() + 1)}${pad(
		CREATED_AT.getDate(),
	)}-${pad(CREATED_AT.getHours())}${pad(CREATED_AT.getMinutes())}`;
};

describe('createPlanFileWriter', () => {
	it('writes into .context/plans and returns a workspace-relative path', async () => {
		const { created, writer, written } = setup();
		const relativePath = await writer.writePlanFile(INPUT);

		expect(created).toEqual([path.join(WORKSPACE_CWD, '.context', 'plans')]);
		expect(relativePath).toBe(
			path.join('.context', 'plans', `${stem()}-add-plan-mode.md`),
		);
		expect(written).toHaveLength(1);
	});

	it('records identity in frontmatter and keeps the plan body', async () => {
		const { writer, written } = setup();
		await writer.writePlanFile(INPUT);

		const contents = written[0]?.contents ?? '';
		expect(contents).toContain('title: "Add Plan Mode"');
		expect(contents).toContain('agentSessionId: "sess-1"');
		expect(contents).toContain('workspaceId: "ws-1"');
		expect(contents).toContain(`createdAt: "${CREATED_AT.toISOString()}"`);
		expect(contents).toContain('# Add Plan Mode');
		expect(contents).toContain('1. Do the thing');
	});

	it('suffixes the filename rather than overwriting a colliding plan', async () => {
		const directory = path.join(WORKSPACE_CWD, '.context', 'plans');
		const { writer } = setup([
			path.join(directory, `${stem()}-add-plan-mode.md`),
			path.join(directory, `${stem()}-add-plan-mode-2.md`),
		]);

		expect(await writer.writePlanFile(INPUT)).toBe(
			path.join('.context', 'plans', `${stem()}-add-plan-mode-3.md`),
		);
	});

	it('strips path separators out of a traversing title', async () => {
		const { writer } = setup();
		const relativePath = await writer.writePlanFile({
			...INPUT,
			title: '../../etc/passwd',
		});

		expect(relativePath.startsWith(path.join('.context', 'plans'))).toBe(true);
		expect(relativePath).not.toContain('..');
	});

	it('falls back to a generic slug when the title has no usable characters', async () => {
		const { writer } = setup();

		expect(await writer.writePlanFile({ ...INPUT, title: '!!!' })).toBe(
			path.join('.context', 'plans', `${stem()}-plan.md`),
		);
	});

	it('caps a very long title so the filename stays usable', async () => {
		const { writer } = setup();
		const relativePath = await writer.writePlanFile({
			...INPUT,
			title: 'a'.repeat(80),
		});

		expect(path.basename(relativePath)).toBe(`${stem()}-${'a'.repeat(60)}.md`);
	});
});

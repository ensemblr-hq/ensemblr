/**
 * Owner of the plan-file convention:
 * `<workspaceCwd>/.context/plans/<YYYYMMDD-HHmm>-<slug>.md`. The app writes the
 * plan rather than the agent, so a plan mode that blocks `write` does not have
 * to punch a hole in itself to save its own output.
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { toSlug } from '../../shared/slug.ts';

/** Directory, relative to the workspace root, that plan files land in. */
const PLANS_SUBDIR = path.join('.context', 'plans');

/** Keeps a long plan title from producing an unwieldy filename. */
const MAX_SLUG_LENGTH = 60;

/** Filename slug used when a title slugifies to nothing (e.g. all punctuation). */
const FALLBACK_SLUG = 'plan';

/** How many suffixed names to try before giving up on a colliding stem. */
const MAX_COLLISION_ATTEMPTS = 50;

/** What the agent submitted, plus the identity recorded in the frontmatter. */
export interface WritePlanFileInput {
	plan: string;
	agentSessionId: string;
	title: string;
	workspaceCwd: string;
	workspaceId: string;
}

/** Injectable clock and filesystem, so tests never touch a real disk. */
export interface PlanFileWriterOptions {
	now?: () => Date;
	mkdir?: (dirPath: string) => Promise<void>;
	writeFile?: (filePath: string, contents: string) => Promise<void>;
	/** Whether a path already exists, used to pick a non-colliding filename. */
	exists?: (filePath: string) => Promise<boolean>;
}

/** Public surface of the plan-file writer. */
export interface PlanFileWriter {
	/** Writes the plan and resolves its workspace-relative path. */
	writePlanFile: (input: WritePlanFileInput) => Promise<string>;
}

/**
 * Pads a number to two digits for the filename timestamp.
 * @param value - Month, day, hour, or minute.
 * @returns The zero-padded string.
 */
function pad(value: number): string {
	return String(value).padStart(2, '0');
}

/**
 * Renders the local-time `YYYYMMDD-HHmm` prefix that sorts plan files by when
 * they were written.
 * @param now - Creation time.
 * @returns The timestamp prefix.
 */
function timestampPrefix(now: Date): string {
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/**
 * Builds the filename stem for a plan. `path.basename` guards the stem against
 * a title that slugifies into path separators.
 * @param title - Agent-supplied plan title.
 * @param now - Creation time.
 * @returns The `<timestamp>-<slug>` stem.
 */
function planFileStem(title: string, now: Date): string {
	const slug = toSlug(title, FALLBACK_SLUG).slice(0, MAX_SLUG_LENGTH);
	return path.basename(`${timestampPrefix(now)}-${slug}`);
}

/**
 * Finds the first free filename for a stem, appending `-2`, `-3`, … on
 * collision so two plans written in the same minute never overwrite each other.
 * @param args - Target directory, filename stem, and the existence probe.
 * @returns The absolute path to write to.
 */
async function resolveFreePath({
	directory,
	exists,
	stem,
}: {
	directory: string;
	exists: (filePath: string) => Promise<boolean>;
	stem: string;
}): Promise<string> {
	for (let attempt = 1; attempt <= MAX_COLLISION_ATTEMPTS; attempt += 1) {
		const suffix = attempt === 1 ? '' : `-${attempt}`;
		const candidate = path.join(directory, `${stem}${suffix}.md`);
		if (!(await exists(candidate))) {
			return candidate;
		}
	}
	throw new Error(
		`Could not find a free plan filename for "${stem}" after ${MAX_COLLISION_ATTEMPTS} attempts.`,
	);
}

/**
 * Renders the plan file's YAML frontmatter.
 * @param input - Plan identity fields.
 * @param createdAt - ISO creation timestamp.
 * @returns The frontmatter block, terminated with a newline.
 */
function renderFrontmatter(
	input: WritePlanFileInput,
	createdAt: string,
): string {
	const lines = [
		'---',
		`title: ${JSON.stringify(input.title)}`,
		`agentSessionId: ${JSON.stringify(input.agentSessionId)}`,
		`workspaceId: ${JSON.stringify(input.workspaceId)}`,
		`createdAt: ${JSON.stringify(createdAt)}`,
		'---',
	];
	return `${lines.join('\n')}\n`;
}

/**
 * Builds a plan-file writer over the real clock and filesystem unless
 * overridden.
 * @param options - Clock and filesystem overrides for tests.
 * @returns The writer the exit-plan-mode coordinator delegates to.
 */
export function createPlanFileWriter(
	options: PlanFileWriterOptions = {},
): PlanFileWriter {
	const now = options.now ?? (() => new Date());
	const mkdirImpl =
		options.mkdir ??
		((p) => mkdir(p, { recursive: true }).then(() => undefined));
	const writeFileImpl =
		options.writeFile ?? ((p, contents) => writeFile(p, contents, 'utf8'));
	const existsImpl =
		options.exists ??
		((p) =>
			access(p).then(
				() => true,
				() => false,
			));

	return {
		writePlanFile: async (input) => {
			const createdAt = now();
			const directory = path.join(input.workspaceCwd, PLANS_SUBDIR);
			await mkdirImpl(directory);
			const filePath = await resolveFreePath({
				directory,
				exists: existsImpl,
				stem: planFileStem(input.title, createdAt),
			});
			const frontmatter = renderFrontmatter(input, createdAt.toISOString());
			await writeFileImpl(
				filePath,
				`${frontmatter}\n# ${input.title}\n\n${input.plan.trim()}\n`,
			);
			return path.relative(input.workspaceCwd, filePath);
		},
	};
}

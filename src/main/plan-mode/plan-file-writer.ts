/**
 * Owner of the plan-file convention:
 * `<workspaceCwd>/.context/plans/<YYYYMMDD-HHmm>-<slug>.md`. The app writes the
 * plan rather than the agent, so a plan mode that blocks `write` does not have
 * to punch a hole in itself to save its own output. Each conversation keeps its
 * original file across refinements and restarts, identified by its frontmatter.
 */
import { randomUUID } from 'node:crypto';
import {
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises';
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

/** Maximum plan files read from disk at once while locating a prior plan. */
const PLAN_READ_CONCURRENCY = 8;

/** What the agent submitted, plus the identity recorded in the frontmatter. */
export interface WritePlanFileInput {
	plan: string;
	agentSessionId: string;
	title: string;
	workspaceCwd: string;
	workspaceId: string;
}

/** Injectable clock and exclusive writer for deterministic failure tests. */
export interface PlanFileWriterOptions {
	now?: () => Date;
	writeFile?: (filePath: string, contents: string) => Promise<void>;
}

/** Public surface of the plan-file writer. */
export interface PlanFileWriter {
	/** Creates or revises the conversation's plan and returns its original relative path. */
	writePlanFile: (input: WritePlanFileInput) => Promise<string>;
}

/** Persisted identity needed to recognize and update a conversation's plan. */
interface PlanFileMetadata {
	agentSessionId: string;
	createdAt: string;
	workspaceId: string;
}

/** A matching plan file and the creation time that determines the original. */
interface ExistingPlanFile {
	createdAt: string;
	filePath: string;
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
 * Checks an unknown thrown value for a Node filesystem error code.
 * @param error - Thrown value to inspect.
 * @param code - Expected filesystem code.
 * @returns True when the error carries the requested code.
 */
function hasErrorCode(error: unknown, code: string): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		error.code === code
	);
}

/**
 * Reports whether a resolved path remains strictly below a resolved root.
 * @param root - Real workspace root.
 * @param candidate - Real candidate directory.
 * @returns True when the candidate is inside the root.
 */
function isInside(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return (
		relative !== '' &&
		relative !== '..' &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
	);
}

/**
 * Creates and validates each plan-directory level before any file write.
 * @param workspaceCwd - Trusted workspace root.
 * @returns The validated absolute plans directory.
 */
async function preparePlansDirectory(workspaceCwd: string): Promise<string> {
	const workspaceRealPath = await realpath(workspaceCwd);
	let directory = workspaceCwd;
	for (const segment of PLANS_SUBDIR.split(path.sep)) {
		directory = path.join(directory, segment);
		await mkdir(directory, { recursive: true });
		if (!isInside(workspaceRealPath, await realpath(directory))) {
			throw new Error('Plan directory must stay inside the workspace.');
		}
	}
	return directory;
}

/**
 * Reads one JSON-encoded string field from generated YAML frontmatter.
 * @param lines - Frontmatter lines without delimiters.
 * @param key - Field name to find.
 * @returns The decoded string, or null when absent or invalid.
 */
function readFrontmatterString(
	lines: readonly string[],
	key: string,
): string | null {
	const prefix = `${key}: `;
	const line = lines.find((candidate) => candidate.startsWith(prefix));
	if (!line) {
		return null;
	}
	try {
		const value: unknown = JSON.parse(line.slice(prefix.length));
		return typeof value === 'string' ? value : null;
	} catch {
		return null;
	}
}

/**
 * Parses identity fields from a plan generated by this writer.
 * @param contents - Plan markdown text.
 * @returns Valid plan identity, or null for unrelated/malformed markdown.
 */
function parsePlanMetadata(contents: string): PlanFileMetadata | null {
	const lines = contents.split(/\r?\n/);
	if (lines[0] !== '---') {
		return null;
	}
	const closingIndex = lines.indexOf('---', 1);
	if (closingIndex < 0) {
		return null;
	}
	const frontmatter = lines.slice(1, closingIndex);
	const agentSessionId = readFrontmatterString(frontmatter, 'agentSessionId');
	const workspaceId = readFrontmatterString(frontmatter, 'workspaceId');
	const createdAt = readFrontmatterString(frontmatter, 'createdAt');
	if (
		!agentSessionId ||
		!workspaceId ||
		!createdAt ||
		!Number.isFinite(Date.parse(createdAt))
	) {
		return null;
	}
	return { agentSessionId, createdAt, workspaceId };
}

/**
 * Reads one plan candidate and returns it only when its identity matches.
 * @param directory - Validated plans directory.
 * @param fileName - Markdown filename to inspect.
 * @param input - Identity to match.
 * @returns The matching plan candidate, or null.
 */
async function readPlanCandidate(
	directory: string,
	fileName: string,
	input: WritePlanFileInput,
): Promise<ExistingPlanFile | null> {
	const filePath = path.join(directory, fileName);
	const metadata = parsePlanMetadata(await readFile(filePath, 'utf8'));
	return metadata?.agentSessionId === input.agentSessionId &&
		metadata.workspaceId === input.workspaceId
		? { createdAt: metadata.createdAt, filePath }
		: null;
}

/**
 * Finds the earliest persisted plan for one conversation and workspace.
 * @param directory - Validated plans directory.
 * @param input - Identity to match.
 * @returns The original matching plan, or null for a first submission.
 */
async function findExistingPlan(
	directory: string,
	input: WritePlanFileInput,
): Promise<ExistingPlanFile | null> {
	const entries = await readdir(directory, { withFileTypes: true });
	const fileNames = entries.flatMap((entry) =>
		entry.isFile() && path.extname(entry.name) === '.md' ? [entry.name] : [],
	);
	const matches: ExistingPlanFile[] = [];
	for (
		let start = 0;
		start < fileNames.length;
		start += PLAN_READ_CONCURRENCY
	) {
		const batch = fileNames.slice(start, start + PLAN_READ_CONCURRENCY);
		const candidates = await Promise.all(
			batch.map((fileName) => readPlanCandidate(directory, fileName, input)),
		);
		matches.push(...candidates.filter((candidate) => candidate !== null));
	}
	matches.sort(
		(left, right) =>
			Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
			left.filePath.localeCompare(right.filePath),
	);
	return matches[0] ?? null;
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
 * Renders the complete plan document.
 * @param input - Current title, identity, and plan body.
 * @param createdAt - Original creation timestamp.
 * @returns Markdown document ready to persist.
 */
function renderPlan(input: WritePlanFileInput, createdAt: string): string {
	return `${renderFrontmatter(input, createdAt)}\n# ${input.title}\n\n${input.plan.trim()}\n`;
}

/**
 * Replaces an existing plan only after its complete successor is on disk.
 * @param filePath - Original plan path to preserve.
 * @param contents - Refined plan document.
 * @param writeExclusive - Exclusive temporary-file writer.
 */
async function replacePlanFile(
	filePath: string,
	contents: string,
	writeExclusive: (filePath: string, contents: string) => Promise<void>,
): Promise<void> {
	const temporaryPath = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${randomUUID()}.tmp`,
	);
	try {
		await writeExclusive(temporaryPath, contents);
		await rename(temporaryPath, filePath);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

/**
 * Creates a new plan without following or overwriting an existing path.
 * @param directory - Validated plans directory.
 * @param stem - Timestamped title stem.
 * @param contents - Complete plan document.
 * @param writeExclusive - Writer that fails with `EEXIST` on collisions.
 * @returns Absolute path of the created plan.
 */
async function createNewPlanFile(
	directory: string,
	stem: string,
	contents: string,
	writeExclusive: (filePath: string, contents: string) => Promise<void>,
): Promise<string> {
	for (let attempt = 1; attempt <= MAX_COLLISION_ATTEMPTS; attempt += 1) {
		const suffix = attempt === 1 ? '' : `-${attempt}`;
		const candidate = path.join(directory, `${stem}${suffix}.md`);
		try {
			await writeExclusive(candidate, contents);
			return candidate;
		} catch (error) {
			if (!hasErrorCode(error, 'EEXIST')) {
				throw error;
			}
		}
	}
	throw new Error(
		`Could not find a free plan filename for "${stem}" after ${MAX_COLLISION_ATTEMPTS} attempts.`,
	);
}

/**
 * Builds a plan-file writer over the real clock and filesystem unless
 * overridden.
 * @param options - Clock and exclusive-write override for tests.
 * @returns The writer the exit-plan-mode coordinator delegates to.
 */
export function createPlanFileWriter(
	options: PlanFileWriterOptions = {},
): PlanFileWriter {
	const now = options.now ?? (() => new Date());
	const writeExclusive =
		options.writeFile ??
		((filePath, contents) =>
			writeFile(filePath, contents, { encoding: 'utf8', flag: 'wx' }));
	const pendingWrites = new Map<string, Promise<void>>();

	/**
	 * Persists one plan after its identity's preceding write has settled.
	 * @param input - Plan content and trusted workspace/session identity.
	 * @returns The persisted plan's workspace-relative path.
	 */
	async function persistPlanFile(input: WritePlanFileInput): Promise<string> {
		const directory = await preparePlansDirectory(input.workspaceCwd);
		const existing = await findExistingPlan(directory, input);
		if (existing) {
			await replacePlanFile(
				existing.filePath,
				renderPlan(input, existing.createdAt),
				writeExclusive,
			);
			return path.relative(input.workspaceCwd, existing.filePath);
		}
		const createdAt = now();
		const filePath = await createNewPlanFile(
			directory,
			planFileStem(input.title, createdAt),
			renderPlan(input, createdAt.toISOString()),
			writeExclusive,
		);
		return path.relative(input.workspaceCwd, filePath);
	}

	/**
	 * Serializes writes for one workspace conversation and releases idle queues.
	 * @param input - Plan content and trusted workspace/session identity.
	 * @returns The persisted plan's workspace-relative path.
	 */
	function writePlanFile(input: WritePlanFileInput): Promise<string> {
		const key = JSON.stringify([input.workspaceId, input.agentSessionId]);
		const preceding = pendingWrites.get(key) ?? Promise.resolve();
		const current = preceding.then(() => persistPlanFile(input));
		const tail = current.then(
			() => undefined,
			() => undefined,
		);
		pendingWrites.set(key, tail);
		return current.finally(() => {
			if (pendingWrites.get(key) === tail) {
				pendingWrites.delete(key);
			}
		});
	}

	return { writePlanFile };
}

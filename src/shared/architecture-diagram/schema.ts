/**
 * Zod validator for the architecture IR.
 *
 * A document reaching this schema is untrusted: it comes off the wire from the
 * renderer, out of SQLite where an older build wrote it, or from an agent. It
 * is deliberately lenient in one direction and strict in the other — `z.object`
 * *strips* unknown keys rather than rejecting them, so a document archify
 * authored (which carries brand marks, guided views, and quality profiles this
 * renderer has no use for) still loads, while every key it does understand has
 * to hold the right shape.
 *
 * The few fields archify spells with an underscore are accepted under both
 * spellings and normalized to the camelCase one the types use.
 */
import { z } from 'zod';

import {
	ARCHITECTURE_IR_SCHEMA_VERSION,
	type ArchitectureIR,
} from './types.ts';

const componentIdSchema = z
	.string()
	.regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'Component ids must be identifier-like.');

const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);

const sizeSchema = z.tuple([z.number().positive(), z.number().positive()]);

const sideSchema = z.enum(['left', 'right', 'top', 'bottom']);

/**
 * How many source references one component may carry. A node stands for one
 * place in the tree; a list of ten paths is a node that should have been
 * several. Exported because the agent-facing tool descriptions have to state
 * it — an undocumented cap reads as an unexplained rejection.
 */
export const MAX_COMPONENT_SOURCES = 3;

/**
 * Widest grid a document may declare. Twelve columns is already past what fits
 * a panel; exported for the same reason as {@link MAX_COMPONENT_SOURCES} — an
 * agent laying a diagram out has to be told the bound before it hits it.
 */
export const ARCHITECTURE_LAYOUT_MAX_COLS = 12;

/**
 * Tallest grid a document may declare, as a track count.
 *
 * Rows scroll where columns do not, so this is far looser than
 * {@link ARCHITECTURE_LAYOUT_MAX_COLS} — but it is a ceiling rather than a
 * guideline, because the geometry compiler allocates one track entry per row
 * index any component names. Two hundred and fifty-six is past any diagram a
 * reader can follow and still bounds that allocation to something a frame can
 * afford; without it a single `row: 2147483648` aborts the renderer process
 * out of memory.
 */
export const ARCHITECTURE_LAYOUT_MAX_ROWS = 256;

/** Longest single-line name: a component, connection, boundary, or card title. */
const MAX_LABEL_CHARS = 120;

/** Longest secondary line — a sublabel, a subtitle, or one card bullet. */
const MAX_DETAIL_CHARS = 240;

/** Longest component tag, which is a badge rather than a sentence. */
const MAX_TAG_CHARS = 48;

/** How many annotation cards may sit beside one diagram. */
const MAX_CARDS = 12;

/** How many bullets one annotation card may list. */
const MAX_CARD_ITEMS = 16;

/** How many authored interior points one edge may route through. */
const MAX_CONNECTION_VIA_POINTS = 24;

/** How many components one boundary may enclose. */
const MAX_BOUNDARY_MEMBERS = 256;

const PARENT_DIRECTORY_SEGMENT = '..';

const ESCAPING_PATH_PREFIX = /^([/\\]|~|[a-zA-Z]:)/;

const PATH_SEPARATOR = /[/\\]/;

/**
 * Whether a source path still points inside the workspace once the file
 * preview resolves it.
 *
 * The preview deliberately opens files outside the workspace, so without this
 * a committed `.ensemblr/architecture.json` from a cloned repository could aim
 * a node at `~/.config/gh/hosts.yml` and render the user's token on one click.
 * `src/shared` may not import `node:path`, so the escaping shapes are rejected
 * by inspection instead: an absolute POSIX or UNC path, a Windows drive
 * letter, a home-relative `~`, and a `..` segment anywhere along the path. The
 * candidate is trimmed first because the preview resolver trims before it
 * expands `~`.
 * @param rawPath - The path as the document wrote it
 * @returns True when the path is workspace-relative
 */
function isWorkspaceRelativePath(rawPath: string): boolean {
	const candidate = rawPath.trim();
	if (ESCAPING_PATH_PREFIX.test(candidate)) {
		return false;
	}
	return !candidate.split(PATH_SEPARATOR).includes(PARENT_DIRECTORY_SEGMENT);
}

const WORKSPACE_RELATIVE_PATH_MESSAGE =
	'Source paths must be workspace-relative: no leading "/", "\\", "~", or drive letter, and no ".." segment.';

const sourceRefSchema = z
	.object({
		end_line: z.number().int().positive().optional(),
		endLine: z.number().int().positive().optional(),
		label: z.string().min(1).max(48).optional(),
		line: z.number().int().positive().optional(),
		path: z
			.string()
			.min(1)
			.max(240)
			.refine(isWorkspaceRelativePath, WORKSPACE_RELATIVE_PATH_MESSAGE),
	})
	.transform((raw) => {
		const endLine = raw.endLine ?? raw.end_line;
		return {
			...(endLine === undefined ? {} : { endLine }),
			...(raw.label === undefined ? {} : { label: raw.label }),
			...(raw.line === undefined ? {} : { line: raw.line }),
			path: raw.path,
		};
	});

const componentSchema = z.object({
	col: z
		.number()
		.int()
		.min(0)
		.max(ARCHITECTURE_LAYOUT_MAX_COLS - 1)
		.optional(),
	id: componentIdSchema,
	label: z.string().min(1).max(MAX_LABEL_CHARS),
	pos: pointSchema.optional(),
	row: z
		.number()
		.int()
		.min(0)
		.max(ARCHITECTURE_LAYOUT_MAX_ROWS - 1)
		.optional(),
	size: sizeSchema.optional(),
	sources: z
		.array(sourceRefSchema)
		.min(1)
		.max(MAX_COMPONENT_SOURCES)
		.optional(),
	sublabel: z.string().max(MAX_DETAIL_CHARS).optional(),
	tag: z.string().max(MAX_TAG_CHARS).optional(),
	type: z.enum([
		'frontend',
		'backend',
		'database',
		'cloud',
		'security',
		'messagebus',
		'external',
	]),
});

const boundarySchema = z.object({
	kind: z.enum(['region', 'security-group']),
	label: z.string().min(1).max(MAX_LABEL_CHARS),
	pad: z.number().min(0).optional(),
	wraps: z.array(componentIdSchema).min(1).max(MAX_BOUNDARY_MEMBERS),
});

const connectionSchema = z.object({
	from: componentIdSchema,
	fromSide: sideSchema.optional(),
	id: componentIdSchema.optional(),
	label: z.string().max(MAX_LABEL_CHARS).optional(),
	labelAt: pointSchema.optional(),
	labelDx: z.number().finite().optional(),
	labelDy: z.number().finite().optional(),
	labelSegment: z.number().int().min(0).optional(),
	route: z
		.enum(['auto', 'straight', 'orthogonal-h', 'orthogonal-v'])
		.optional(),
	to: componentIdSchema,
	toSide: sideSchema.optional(),
	variant: z.enum(['default', 'emphasis', 'security', 'dashed']).optional(),
	via: z.array(pointSchema).max(MAX_CONNECTION_VIA_POINTS).optional(),
});

const layoutSchema = z.object({
	cellH: z.number().min(24).optional(),
	cellW: z.number().min(40).optional(),
	cols: z.number().int().min(1).max(ARCHITECTURE_LAYOUT_MAX_COLS).optional(),
	gapX: z.number().min(0).optional(),
	gapY: z.number().min(0).optional(),
	mode: z.enum(['grid', 'organic']),
	origin: pointSchema.optional(),
});

const metaSchema = z.object({
	subtitle: z.string().max(MAX_DETAIL_CHARS).optional(),
	title: z.string().min(1).max(MAX_LABEL_CHARS),
	viewBox: sizeSchema.optional(),
});

const cardSchema = z.object({
	dot: z.enum([
		'cyan',
		'emerald',
		'violet',
		'amber',
		'rose',
		'orange',
		'slate',
	]),
	items: z.array(z.string().max(MAX_DETAIL_CHARS)).max(MAX_CARD_ITEMS),
	title: z.string().min(1).max(MAX_LABEL_CHARS),
});

/**
 * Fills in an id for a connection that carries none.
 *
 * Every producer in this app emits one, because the delta comparator matches
 * edges by id. archify's schema leaves it optional, so a document authored
 * there would otherwise be unloadable — and an edge with no id is an edge the
 * delta reports as removed-and-added on every rebuild.
 *
 * The derived id is a function of the endpoints rather than of position, so
 * reordering the connection list does not renumber the diagram; a duplicate
 * pair (two edges between the same two nodes) takes a numeric suffix.
 * @param connections - Connections as parsed, some without an id
 * @returns The same connections, each with an id
 */
function withDerivedConnectionIds<
	T extends { from: string; id?: string; to: string },
>(connections: readonly T[]): (T & { id: string })[] {
	const used = new Set(
		connections.flatMap((connection) => (connection.id ? [connection.id] : [])),
	);
	return connections.map((connection) => {
		if (connection.id) {
			return { ...connection, id: connection.id };
		}
		const base = `${connection.from}-to-${connection.to}`;
		let candidate = base;
		let suffix = 2;
		while (used.has(candidate)) {
			candidate = `${base}-${suffix}`;
			suffix += 1;
		}
		used.add(candidate);
		return { ...connection, id: candidate };
	});
}

/**
 * Adds one issue per key that repeats, pointing at the entry that repeats it
 * rather than at the one that claimed it first — the later entry is the one an
 * author has to rename.
 * @param keys - One key per entry, in document order
 * @param pathOf - Field path of the entry at a given index
 * @param subject - What the key identifies, opening the message
 * @param ctx - Refinement context collecting the issues
 */
function reportDuplicateKeys(
	keys: readonly string[],
	pathOf: (index: number) => (number | string)[],
	subject: string,
	ctx: z.core.$RefinementCtx,
): void {
	const seen = new Set<string>();
	for (const [index, key] of keys.entries()) {
		if (seen.has(key)) {
			ctx.addIssue({
				code: 'custom',
				message: `${subject} must be unique; "${key}" is used more than once.`,
				path: pathOf(index),
			});
			continue;
		}
		seen.add(key);
	}
}

/**
 * Adds an issue when an id names a component the document never declares.
 * @param id - The referenced component id
 * @param path - Field path of the reference
 * @param declared - Every component id the document declares
 * @param ctx - Refinement context collecting the issues
 */
function reportUnknownComponent(
	id: string,
	path: (number | string)[],
	declared: ReadonlySet<string>,
	ctx: z.core.$RefinementCtx,
): void {
	if (declared.has(id)) {
		return;
	}
	ctx.addIssue({
		code: 'custom',
		message: `No component is declared with id "${id}".`,
		path,
	});
}

/**
 * Checks the two rules a per-field schema cannot see: that nothing shares an
 * identity, and that every edge and boundary names a component that exists.
 *
 * Both are silent corruptions downstream rather than errors. The delta
 * comparator and the geometry compiler index components, connections, and
 * boundaries into `Map`s where the last entry wins, so a duplicate id renders
 * twice under one React key and steals every edge aimed at the other; an
 * endpoint that resolves to nothing is dropped from the drawing without a
 * word, which leaves an agent a success response and an invisible edge.
 *
 * It runs after the transform, so it sees derived connection ids and the final
 * component list.
 * @param ir - The document as the transform produced it
 * @param ctx - Refinement context collecting the issues
 */
function checkIrIntegrity(
	ir: ArchitectureIR,
	ctx: z.core.$RefinementCtx,
): void {
	const connections = ir.connections ?? [];
	const boundaries = ir.boundaries ?? [];
	reportDuplicateKeys(
		ir.components.map((component) => component.id),
		(index) => ['components', index, 'id'],
		'Component ids',
		ctx,
	);
	reportDuplicateKeys(
		connections.map((connection) => connection.id),
		(index) => ['connections', index, 'id'],
		'Connection ids',
		ctx,
	);
	reportDuplicateKeys(
		boundaries.map((boundary) => `${boundary.kind}:${boundary.label}`),
		(index) => ['boundaries', index, 'label'],
		'A boundary kind and label together',
		ctx,
	);
	const declared = new Set(ir.components.map((component) => component.id));
	for (const [index, connection] of connections.entries()) {
		reportUnknownComponent(
			connection.from,
			['connections', index, 'from'],
			declared,
			ctx,
		);
		reportUnknownComponent(
			connection.to,
			['connections', index, 'to'],
			declared,
			ctx,
		);
	}
	for (const [index, boundary] of boundaries.entries()) {
		for (const [member, id] of boundary.wraps.entries()) {
			reportUnknownComponent(
				id,
				['boundaries', index, 'wraps', member],
				declared,
				ctx,
			);
		}
	}
}

/**
 * The architecture IR as it is accepted from any untrusted producer. Unknown
 * keys are dropped, so nothing an older or foreign producer added reaches the
 * compiler.
 */
export const architectureIrSchema = z
	.object({
		boundaries: z.array(boundarySchema).optional(),
		cards: z.array(cardSchema).max(MAX_CARDS).optional(),
		components: z.array(componentSchema),
		connections: z.array(connectionSchema).optional(),
		layout: layoutSchema.optional(),
		meta: metaSchema,
		schema_version: z.number().int().optional(),
		schemaVersion: z.number().int().optional(),
	})
	.transform(
		(raw): ArchitectureIR => ({
			...(raw.boundaries ? { boundaries: raw.boundaries } : {}),
			...(raw.cards ? { cards: raw.cards } : {}),
			components: raw.components,
			...(raw.connections
				? { connections: withDerivedConnectionIds(raw.connections) }
				: {}),
			...(raw.layout ? { layout: raw.layout } : {}),
			meta: raw.meta,
			schemaVersion:
				raw.schemaVersion ??
				raw.schema_version ??
				ARCHITECTURE_IR_SCHEMA_VERSION,
		}),
	)
	.superRefine(checkIrIntegrity);

/** How many rejected fields a failed parse names before it stops listing them. */
const MAX_REPORTED_ISSUES = 6;

/**
 * A parse that either produced an IR or can say which fields stopped it.
 *
 * `problems` is capped at {@link MAX_REPORTED_ISSUES} named fields plus a line
 * saying how many went unnamed, so a caller that only prints the list still
 * tells its author there is more to fix. `problemCount` is the untruncated
 * total, for a caller that would rather say so in its own words.
 */
export type ArchitectureIrParse =
	| { ir: ArchitectureIR; ok: true }
	| { ok: false; problemCount: number; problems: string[] };

/**
 * Parses a candidate IR and, when it fails, names the fields that failed.
 *
 * The bare {@link parseArchitectureIr} is enough for a surface, which only has
 * an empty state to fall back to. An agent submitting a document needs to know
 * *which* field it has to fix: told only "that is not a valid diagram" it
 * reliably resubmits the same document with a different guess removed.
 * @param raw - The candidate document
 * @returns The parsed IR, or the field paths that rejected it
 */
export function parseArchitectureIrResult(raw: unknown): ArchitectureIrParse {
	const result = architectureIrSchema.safeParse(raw);
	if (result.success) {
		return { ir: result.data, ok: true };
	}
	const named = result.error.issues
		.slice(0, MAX_REPORTED_ISSUES)
		.map((issue) => {
			const where =
				issue.path.length > 0 ? issue.path.join('.') : 'the document';
			return `${where}: ${issue.message}`;
		});
	const unnamed = result.error.issues.length - named.length;
	return {
		ok: false,
		problemCount: result.error.issues.length,
		problems:
			unnamed > 0
				? [
						...named,
						`${unnamed} further field(s) also failed and are not listed; fix these and resubmit to see the rest.`,
					]
				: named,
	};
}

/**
 * Parses a stored or wire-supplied IR, returning null rather than throwing.
 * Callers are surfaces — a panel, a snapshot read — for which an unreadable
 * document means "show the empty state", not "fail the request".
 * @param raw - The candidate document
 * @returns The parsed IR, or null when it does not validate
 */
export function parseArchitectureIr(raw: unknown): ArchitectureIR | null {
	const result = parseArchitectureIrResult(raw);
	return result.ok ? result.ir : null;
}

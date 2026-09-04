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

const sourceRefSchema = z
	.object({
		end_line: z.number().int().positive().optional(),
		endLine: z.number().int().positive().optional(),
		label: z.string().min(1).max(48).optional(),
		line: z.number().int().positive().optional(),
		path: z.string().min(1).max(240),
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
	col: z.number().int().min(0).optional(),
	id: componentIdSchema,
	label: z.string().min(1),
	pos: pointSchema.optional(),
	row: z.number().int().min(0).optional(),
	size: sizeSchema.optional(),
	sources: z
		.array(sourceRefSchema)
		.min(1)
		.max(MAX_COMPONENT_SOURCES)
		.optional(),
	sublabel: z.string().optional(),
	tag: z.string().optional(),
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
	label: z.string().min(1),
	pad: z.number().min(0).optional(),
	wraps: z.array(componentIdSchema).min(1),
});

const connectionSchema = z.object({
	from: componentIdSchema,
	fromSide: sideSchema.optional(),
	id: componentIdSchema.optional(),
	label: z.string().optional(),
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
	via: z.array(pointSchema).optional(),
});

const layoutSchema = z.object({
	cellH: z.number().min(24).optional(),
	cellW: z.number().min(40).optional(),
	cols: z.number().int().min(1).max(ARCHITECTURE_LAYOUT_MAX_COLS).optional(),
	gapX: z.number().min(0).optional(),
	gapY: z.number().min(0).optional(),
	mode: z.literal('grid'),
	origin: pointSchema.optional(),
});

const metaSchema = z.object({
	subtitle: z.string().optional(),
	title: z.string().min(1),
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
	items: z.array(z.string()),
	title: z.string().min(1),
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
 * The architecture IR as it is accepted from any untrusted producer. Unknown
 * keys are dropped, so nothing an older or foreign producer added reaches the
 * compiler.
 */
export const architectureIrSchema = z
	.object({
		boundaries: z.array(boundarySchema).optional(),
		cards: z.array(cardSchema).optional(),
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
	);

/** How many rejected fields a failed parse names before it stops listing them. */
const MAX_REPORTED_ISSUES = 6;

/** A parse that either produced an IR or can say which fields stopped it. */
export type ArchitectureIrParse =
	| { ir: ArchitectureIR; ok: true }
	| { ok: false; problems: string[] };

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
	const problems = result.error.issues
		.slice(0, MAX_REPORTED_ISSUES)
		.map((issue) => {
			const where =
				issue.path.length > 0 ? issue.path.join('.') : 'the document';
			return `${where}: ${issue.message}`;
		});
	return { ok: false, problems };
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

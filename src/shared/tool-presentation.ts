import type { IconName } from 'lucide-react/dynamic';
import { z } from 'zod';
import { LUCIDE_ICON_NAMES } from './tool-presentation/lucide-icon-names.gen.ts';

const TOOL_PRESENTATION_VERSION = 1 as const;
const TOOL_PRESENTATION_MAX_JSON_BYTES = 64 * 1024;
const TOOL_PRESENTATION_MAX_TITLE_CHARS = 160;
const TOOL_PRESENTATION_MAX_PREVIEW_CHARS = 512;
const TOOL_PRESENTATION_MAX_BODY_STRING_CHARS = 32 * 1024;
const TOOL_PRESENTATION_MAX_LIST_ENTRIES = 100;
const TOOL_PRESENTATION_MAX_LABELED_SECTIONS = 16;

const bodyStringSchema = z
	.string()
	.max(TOOL_PRESENTATION_MAX_BODY_STRING_CHARS);
const titleStringSchema = z
	.string()
	.min(1)
	.max(TOOL_PRESENTATION_MAX_TITLE_CHARS);
const titleTranslationsSchema = z.strictObject({
	en: titleStringSchema,
	ru: titleStringSchema.optional(),
	el: titleStringSchema.optional(),
});
const titleSchema = z.union([titleStringSchema, titleTranslationsSchema]);
const bodyTranslationsSchema = z.strictObject({
	en: bodyStringSchema,
	ru: bodyStringSchema.optional(),
	el: bodyStringSchema.optional(),
});
const bodyTextSchema = z.union([bodyStringSchema, bodyTranslationsSchema]);
const previewStringSchema = z.string().max(TOOL_PRESENTATION_MAX_PREVIEW_CHARS);
const previewTranslationsSchema = z.strictObject({
	en: previewStringSchema,
	ru: previewStringSchema.optional(),
	el: previewStringSchema.optional(),
});
const previewTextSchema = z.union([
	previewStringSchema,
	previewTranslationsSchema,
]);

/** A Lucide kebab-case name validated against the installed icon set. */
export type ToolExtensionGlyph = IconName;

/** Checks whether a name is exported by the installed Lucide icon set. */
function isLucideGlyph(value: string): value is ToolExtensionGlyph {
	return LUCIDE_ICON_NAMES.has(value);
}

const lucideGlyphSchema = z
	.string()
	.refine(isLucideGlyph)
	.transform((value) => value as ToolExtensionGlyph);

const markdownBodySchema = z.strictObject({
	kind: z.literal('markdown'),
	text: bodyTextSchema,
});
const codeBodySchema = z.strictObject({
	kind: z.literal('code'),
	language: bodyStringSchema.min(1),
	code: bodyStringSchema,
	startLine: z.number().int().nonnegative().nullable().optional(),
});
const labeledSectionSchema = z.strictObject({
	label: bodyTextSchema,
	text: bodyTextSchema,
	muted: z.boolean().optional(),
});
const labeledBodySchema = z.strictObject({
	kind: z.literal('labeled'),
	sections: z
		.array(labeledSectionSchema)
		.max(TOOL_PRESENTATION_MAX_LABELED_SECTIONS),
});
const terminalBodySchema = z.strictObject({
	kind: z.literal('terminal'),
	text: bodyStringSchema,
});
const diffBodySchema = z.strictObject({
	kind: z.literal('diff'),
	language: bodyStringSchema.min(1),
	patch: bodyStringSchema,
	showFileNames: z.boolean().optional(),
});
const diagnosticEntrySchema = z.strictObject({
	severity: z.enum(['error', 'warning', 'info', 'hint']),
	message: bodyTextSchema,
	line: z.number().int().nonnegative().nullable().optional(),
	column: z.number().int().nonnegative().nullable().optional(),
	source: bodyStringSchema.nullable().optional(),
});
const diagnosticsBodySchema = z.strictObject({
	kind: z.literal('diagnostics'),
	entries: z
		.array(diagnosticEntrySchema)
		.max(TOOL_PRESENTATION_MAX_LIST_ENTRIES),
});
const checklistItemSchema = z.strictObject({
	id: bodyStringSchema.min(1),
	subject: bodyTextSchema,
	status: z.enum(['pending', 'in-progress', 'completed', 'unknown']),
	detail: bodyTextSchema.optional(),
	number: bodyStringSchema.optional(),
});
const checklistBodySchema = z
	.strictObject({
		kind: z.literal('checklist'),
		items: z.array(checklistItemSchema).max(TOOL_PRESENTATION_MAX_LIST_ENTRIES),
	})
	.refine(
		({ items }) => new Set(items.map(({ id }) => id)).size === items.length,
		{ message: 'Checklist item ids must be unique', path: ['items'] },
	);

const presentationBodySchema = z.discriminatedUnion('kind', [
	markdownBodySchema,
	codeBodySchema,
	labeledBodySchema,
	terminalBodySchema,
	diffBodySchema,
	diagnosticsBodySchema,
	checklistBodySchema,
]);

const previewSchema = z.strictObject({
	font: z.enum(['mono', 'sans']),
	text: previewTextSchema,
});

/** Zod validator for the complete portable v1 presentation descriptor. */
export const toolPresentationV1Schema = z.strictObject({
	version: z.literal(TOOL_PRESENTATION_VERSION),
	title: titleSchema,
	glyph: lucideGlyphSchema.optional(),
	preview: previewSchema.optional(),
	body: presentationBodySchema.optional(),
});

/** A display string or its English-first translation map. */
export type ToolPresentationText = z.infer<typeof bodyTextSchema>;

/** A supported body primitive. */
export type ToolPresentationBody = z.infer<typeof presentationBodySchema>;

/** A complete extension-owned v1 presentation descriptor. */
export type ToolPresentationV1 = z.infer<typeof toolPresentationV1Schema>;

/**
 * Parses untrusted extension data and rejects malformed or oversized snapshots.
 * @param raw - Untrusted value received from a Pi result or partial result.
 * @returns A validated v1 descriptor, or null when the value is unsafe.
 */
export function parseToolPresentation(raw: unknown): ToolPresentationV1 | null {
	try {
		const parsed = toolPresentationV1Schema.safeParse(raw);
		if (!parsed.success) {
			return null;
		}
		const serialized = JSON.stringify(parsed.data);
		if (serialized === undefined) {
			return null;
		}
		if (
			new TextEncoder().encode(serialized).byteLength >
			TOOL_PRESENTATION_MAX_JSON_BYTES
		) {
			return null;
		}
		return parsed.data;
	} catch {
		return null;
	}
}

/**
 * Resolves display prose to the requested app language without touching literal
 * code, path, or raw-output fields.
 * @param value - Plain prose or an English-first translation map.
 * @param language - Current app language, optionally including a region suffix.
 * @returns The selected translation, falling back to English.
 */
export function resolveToolPresentationText(
	value: ToolPresentationText,
	language: string,
): string {
	if (typeof value === 'string') {
		return value;
	}
	const locale = language.toLowerCase().split('-')[0];
	return value[locale as 'en' | 'ru' | 'el'] ?? value.en;
}

/**
 * Generates the Pi RPC event taxonomy document from the raw captures in
 * `src/renderer/fixtures/pi-captures/`.
 *
 * Reads every fixture line, groups stdout frames by event signature
 * (`type`, plus the discriminating subtype for `message_update`, `response`,
 * and `extension_ui_request`), records which fields are always/sometimes
 * present with truncated value examples, and emits the observed per-fixture
 * lifecycle orderings. Output: `docs/pi/event-taxonomy.md`.
 *
 * Usage: bun scripts/analyze-pi-fixtures.ts
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const FIXTURE_DIR = join(REPO_ROOT, 'src/renderer/fixtures/pi-captures');
const OUTPUT_PATH = join(REPO_ROOT, 'docs/pi/event-taxonomy.md');
const EXAMPLE_MAX_LENGTH = 72;

type Wrapped = { ts: number; stream: 'stdout' | 'stderr'; raw: string };

interface FieldStats {
	present: number;
	examples: Set<string>;
	types: Set<string>;
}

interface SignatureStats {
	count: number;
	fixtures: Set<string>;
	fields: Map<string, FieldStats>;
}

/**
 * Timeline-impact classification per signature prefix, maintained by hand.
 * `timeline` frames become visible items, `metadata` frames update status-bar
 * state only, `noise` frames produce nothing.
 */
const CLASSIFICATION: ReadonlyArray<{
	prefix: string;
	impact: 'timeline' | 'metadata' | 'noise';
	note: string;
}> = [
	{
		prefix: 'message_start',
		impact: 'timeline',
		note: 'Opens a user/assistant message item (role discriminates).',
	},
	{
		prefix: 'message_update',
		impact: 'timeline',
		note: 'Streaming deltas fold into the open assistant message item.',
	},
	{
		prefix: 'message_end',
		impact: 'timeline',
		note: 'Seals the open message item with authoritative content.',
	},
	{
		prefix: 'tool_execution_start',
		impact: 'timeline',
		note: 'Opens a tool-call item (status: running).',
	},
	{
		prefix: 'tool_execution_update',
		impact: 'timeline',
		note: 'Replaces accumulated tool output on the running item.',
	},
	{
		prefix: 'tool_execution_end',
		impact: 'timeline',
		note: 'Seals the tool-call item (success | error).',
	},
	{
		prefix: 'agent_start',
		impact: 'metadata',
		note: 'Marks prompt processing start; used for turn timing fallback.',
	},
	{
		prefix: 'agent_end',
		impact: 'metadata',
		note: 'Turn settles; carries authoritative message list (used to seal aborted turns).',
	},
	{
		prefix: 'turn_start',
		impact: 'noise',
		note: 'Inner LLM-call boundary; no visible item.',
	},
	{
		prefix: 'turn_end',
		impact: 'noise',
		note: 'Inner LLM-call boundary; content already streamed.',
	},
	{
		prefix: 'response',
		impact: 'metadata',
		note: 'Command acks. `get_session_stats` responses feed the status bar.',
	},
	{
		prefix: 'extension_ui_request:confirm',
		impact: 'timeline',
		note: 'Dialog handshake (approval gate) — visible, awaits client reply.',
	},
	{
		prefix: 'extension_ui_request:select',
		impact: 'timeline',
		note: 'Dialog handshake — visible, awaits client reply.',
	},
	{
		prefix: 'extension_ui_request:input',
		impact: 'timeline',
		note: 'Dialog handshake — visible, awaits client reply.',
	},
	{
		prefix: 'extension_ui_request:editor',
		impact: 'timeline',
		note: 'Dialog handshake — visible, awaits client reply.',
	},
	{
		prefix: 'extension_ui_request',
		impact: 'noise',
		note: 'Fire-and-forget UI sugar (notify/setStatus/...); status text may surface in the status bar.',
	},
	{
		prefix: 'queue_update',
		impact: 'metadata',
		note: 'Pending steering/follow-up counts for the composer, not the timeline.',
	},
	{
		prefix: 'compaction_start',
		impact: 'metadata',
		note: 'Session housekeeping.',
	},
	{
		prefix: 'compaction_end',
		impact: 'metadata',
		note: 'Session housekeeping.',
	},
	{
		prefix: 'auto_retry_start',
		impact: 'metadata',
		note: 'Transient-error retry status.',
	},
	{
		prefix: 'auto_retry_end',
		impact: 'metadata',
		note: 'Transient-error retry status.',
	},
	{
		prefix: 'extension_error',
		impact: 'metadata',
		note: 'Extension failure; log + status, not a conversation item.',
	},
];

/**
 * Hand-verified deviations and confirmations from the captures, kept here so
 * the generated doc carries them. Each entry was checked directly against the
 * named fixture (pi 0.79.1, model gpt-5.3-codex-spark, thinking high).
 */
const FINDINGS: readonly string[] = [
	'Framing held: zero stderr lines and zero unparseable stdout lines across all fixtures.',
	'Top-level event frames carry NO timestamps. `message.timestamp` (epoch ms) exists on user/assistant/toolResult messages; assistant messages also carry undocumented `responseId`. Turn timing must use client capture timestamps, cross-checked against message timestamps.',
	'Thinking blocks stream as `thinking_start` → `thinking_end` with NO `thinking_delta` events, and the final `thinking` text is empty — only an encrypted `thinkingSignature` is present (provider hides reasoning). The thinking UI is therefore duration-only ("Reasoned for Ns"); fixtures win over the doc\'s thinking_delta table (all fixtures).',
	'`message_update` deltas observed: text_start/text_delta/text_end, thinking_start/thinking_end, toolcall_start/toolcall_delta/toolcall_end. The documented `start`, `done`, and `error` variants never appeared; completion is signalled by `message_end` (all fixtures).',
	'Abort: after the `abort` command, the in-flight assistant message ends with `stopReason: "aborted"` and `agent_end` still fires with the partial messages (abort-mid-turn). No error delta is emitted.',
	'`agent_end` carries an undocumented `willRetry: boolean` field (all fixtures).',
	'Messages with `role: "custom"` + `customType` (e.g. `context7_docs`) appear when user-level extensions inject context (markdown-heavy). They are raw context injections → timeline noise, hidden from the conversation.',
	'Tools observed: `read`, `bash`, `edit`, `lsp_diagnostics`. `result.details` keys per tool: edit → `diff`/`patch`/`firstChangedLine`, read → `filePath`/`mode`/`truncated`, lsp_diagnostics → `severity`/`diagnostics`/`totalDiagnostics`/`lspHealth` (file-edit, single-read).',
	'Failed tools: `tool_execution_end` with `isError: true` and plain text content, e.g. `command not found` + `Command exited with code 127` (failing-tool). An extension-denied tool produces the same shape with the block reason as text (permission-gate).',
	'Extension approval handshake confirmed: `extension_ui_request` method `confirm` blocks until the client writes `extension_ui_response` with matching `id`; approve resumes the tool, deny yields `isError: true` "Denied by user" (permission-gate). Project-dir extension discovery did NOT load in RPC mode even with `-a`; the capture passes `-e <path>` explicitly.',
	'ANSI escape codes and emoji are preserved verbatim in tool output text (unicode-and-ansi) — the renderer must strip or render ANSI itself.',
	'`user` message `content` was always an array of typed blocks in captures, never a bare string (all fixtures).',
	'`tool_execution_update.partialResult` confirmed to be accumulated output, not a delta; early updates may have empty `content` (long-output, abort-mid-turn).',
	'500-line bash output arrived untruncated with no `details.truncation`/`fullOutputPath` (long-output) — pi-side truncation thresholds were not reached; client-side "show all N lines" handling is still required.',
];

/** Builds the grouping signature for one parsed stdout frame. */
function signatureOf(frame: Record<string, unknown>): string {
	const type = String(frame.type ?? '<missing type>');
	if (type === 'message_update') {
		const delta = frame.assistantMessageEvent as { type?: string } | undefined;
		return `message_update:${delta?.type ?? '<none>'}`;
	}
	if (type === 'response') {
		return `response:${String(frame.command ?? '<none>')}`;
	}
	if (type === 'extension_ui_request') {
		return `extension_ui_request:${String(frame.method ?? '<none>')}`;
	}
	if (type === 'message_start' || type === 'message_end') {
		const message = frame.message as { role?: string } | undefined;
		return `${type}:${message?.role ?? '<none>'}`;
	}
	return type;
}

/** Truncates one example value into a stable single-line string. */
function exampleOf(value: unknown): string {
	const text = JSON.stringify(value) ?? 'undefined';
	return text.length > EXAMPLE_MAX_LENGTH
		? `${text.slice(0, EXAMPLE_MAX_LENGTH)}…`
		: text;
}

function describeType(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	return typeof value;
}

const signatures = new Map<string, SignatureStats>();
const orderings = new Map<string, string[]>();
const stderrCounts = new Map<string, number>();
const unparsedCounts = new Map<string, number>();
let totalLines = 0;

const fixtureNames = readdirSync(FIXTURE_DIR)
	.filter((name) => name.endsWith('.jsonl'))
	.sort();

for (const fixtureName of fixtureNames) {
	const scenario = fixtureName.replace(/\.jsonl$/, '');
	const sequence: string[] = [];
	const content = readFileSync(join(FIXTURE_DIR, fixtureName), 'utf8');
	for (const line of content.split('\n')) {
		if (line.length === 0) continue;
		totalLines += 1;
		const wrapped = JSON.parse(line) as Wrapped;
		if (wrapped.stream === 'stderr') {
			stderrCounts.set(scenario, (stderrCounts.get(scenario) ?? 0) + 1);
			continue;
		}
		let frame: Record<string, unknown>;
		try {
			frame = JSON.parse(wrapped.raw) as Record<string, unknown>;
		} catch {
			unparsedCounts.set(scenario, (unparsedCounts.get(scenario) ?? 0) + 1);
			continue;
		}
		const signature = signatureOf(frame);
		sequence.push(signature);
		let stats = signatures.get(signature);
		if (!stats) {
			stats = { count: 0, fixtures: new Set(), fields: new Map() };
			signatures.set(signature, stats);
		}
		stats.count += 1;
		stats.fixtures.add(scenario);
		for (const [key, value] of Object.entries(frame)) {
			let field = stats.fields.get(key);
			if (!field) {
				field = { present: 0, examples: new Set(), types: new Set() };
				stats.fields.set(key, field);
			}
			field.present += 1;
			field.types.add(describeType(value));
			if (field.examples.size < 3) {
				field.examples.add(exampleOf(value));
			}
		}
	}
	orderings.set(scenario, sequence);
}

/** Collapses consecutive identical signatures into `name ×N` runs. */
function compressSequence(sequence: string[]): string[] {
	const runs: string[] = [];
	let index = 0;
	while (index < sequence.length) {
		let end = index;
		while (end + 1 < sequence.length && sequence[end + 1] === sequence[index]) {
			end += 1;
		}
		const length = end - index + 1;
		runs.push(length > 1 ? `${sequence[index]} ×${length}` : sequence[index]);
		index = end + 1;
	}
	return runs;
}

function classify(signature: string): { impact: string; note: string } {
	for (const entry of CLASSIFICATION) {
		if (
			signature === entry.prefix ||
			signature.startsWith(`${entry.prefix}:`)
		) {
			return entry;
		}
	}
	return {
		impact: 'UNCLASSIFIED',
		note: 'Add to CLASSIFICATION in the analysis script.',
	};
}

const lines: string[] = [];
lines.push('# Pi RPC Event Taxonomy');
lines.push('');
lines.push(
	'Generated by `bun scripts/analyze-pi-fixtures.ts` from the raw captures in',
);
lines.push(
	'`src/renderer/fixtures/pi-captures/` (see `docs/pi/rpc-protocol.md` for the',
);
lines.push(
	'documented protocol). Do not edit by hand — edit the script and regenerate.',
);
lines.push('');
lines.push(`- Fixtures analyzed: ${fixtureNames.length}`);
lines.push(`- Captured lines: ${totalLines}`);
lines.push(
	`- stderr lines: ${[...stderrCounts.entries()].map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`,
);
lines.push(
	`- Unparseable stdout lines: ${[...unparsedCounts.entries()].map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`,
);
lines.push('');
lines.push('## Signatures and timeline impact');
lines.push('');
lines.push(
	'`signature` groups frames by `type` plus the discriminating subtype:',
);
lines.push(
	'`message_update:<assistantMessageEvent.type>`, `response:<command>`,',
);
lines.push(
	'`extension_ui_request:<method>`, `message_start|message_end:<message.role>`.',
);
lines.push('');
lines.push('| Signature | Count | Impact | Fixtures | Note |');
lines.push('|---|---|---|---|---|');
for (const [signature, stats] of [...signatures.entries()].sort()) {
	const { impact, note } = classify(signature);
	const fixtures =
		stats.fixtures.size === fixtureNames.length
			? 'all'
			: [...stats.fixtures].sort().join(', ');
	lines.push(
		`| \`${signature}\` | ${stats.count} | ${impact} | ${fixtures} | ${note} |`,
	);
}
lines.push('');
lines.push('## Fields per signature');
lines.push('');
for (const [signature, stats] of [...signatures.entries()].sort()) {
	lines.push(`### \`${signature}\``);
	lines.push('');
	lines.push('| Field | Presence | Types | Example |');
	lines.push('|---|---|---|---|');
	for (const [field, fieldStats] of [...stats.fields.entries()].sort()) {
		const presence =
			fieldStats.present === stats.count
				? 'always'
				: `${fieldStats.present}/${stats.count} (optional)`;
		const example = [...fieldStats.examples][0] ?? '';
		lines.push(
			`| \`${field}\` | ${presence} | ${[...fieldStats.types].join(', ')} | \`${example.replaceAll('|', '\\|')}\` |`,
		);
	}
	lines.push('');
}
lines.push('## Observed findings vs documented protocol');
lines.push('');
for (const finding of FINDINGS) {
	lines.push(`- ${finding}`);
}
lines.push('');
lines.push('## Observed orderings');
lines.push('');
for (const [scenario, sequence] of orderings) {
	lines.push(`### ${scenario}`);
	lines.push('');
	lines.push('```');
	for (const run of compressSequence(sequence)) {
		lines.push(run);
	}
	lines.push('```');
	lines.push('');
}

writeFileSync(OUTPUT_PATH, `${lines.join('\n')}\n`);
console.log(`wrote ${OUTPUT_PATH}`);

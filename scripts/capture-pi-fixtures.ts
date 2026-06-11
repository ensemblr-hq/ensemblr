/**
 * Captures raw Pi RPC output for the conversation-timeline scenario matrix.
 *
 * Spawns `pi --mode rpc` inside a throwaway seeded sandbox project (one per
 * scenario, under `.pi-capture-sandbox/`, gitignored), drives each scenario,
 * and writes every stdout/stderr line verbatim to
 * `src/renderer/fixtures/pi-captures/<scenario>.jsonl` as
 * `{"ts":<ms>,"stream":"stdout"|"stderr","raw":"<line>"}` plus a
 * `<scenario>.meta.json` sidecar recording the exact commands sent and exit
 * conditions. Raw lines are written before any parsing so fixtures stay
 * faithful even when a frame is malformed.
 *
 * Usage:
 *   bun scripts/capture-pi-fixtures.ts            # run all scenarios
 *   bun scripts/capture-pi-fixtures.ts file-edit  # run selected scenarios
 *
 * Protocol notes: docs/pi/rpc-protocol.md
 */

import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const SANDBOX_ROOT = join(REPO_ROOT, '.pi-capture-sandbox');
const FIXTURE_DIR = join(REPO_ROOT, 'src/renderer/fixtures/pi-captures');
const DEFAULT_STEP_TIMEOUT_MS = 240_000;
/** Stable stand-in for the machine-local sandbox root in committed fixtures. */
const SANDBOX_PLACEHOLDER = '/sandbox';
/** Stable stand-in for the capturing user (e.g. `ls -la` owner columns). */
const USERNAME_PLACEHOLDER = 'captures';

/**
 * Strips machine-local absolute paths and the local username so committed
 * fixtures (and the snapshots derived from them) are identical regardless of
 * who captures.
 */
function sanitizeCapturedText(text: string): string {
	return text
		.replaceAll(SANDBOX_ROOT, SANDBOX_PLACEHOLDER)
		.replaceAll(userInfo().username, USERNAME_PLACEHOLDER);
}

interface SentRecord {
	ts: number;
	command: Record<string, unknown>;
}

interface ScenarioMeta {
	scenario: string;
	description: string;
	piArgs: string[];
	cwd: string;
	startedAt: number;
	endedAt: number;
	sent: SentRecord[];
	exitCondition: string;
	exitCode: number | null;
	notes: string[];
}

/** Driver handle a scenario uses to talk to one live pi RPC child. */
interface Session {
	/** Sends one JSONL command to pi stdin and records it in the sidecar. */
	send(command: Record<string, unknown>): void;
	/**
	 * Resolves with the first parsed stdout frame matching `pred`. Frames that
	 * fail to parse are skipped (they are still captured raw).
	 */
	waitFor(
		label: string,
		pred: (frame: Record<string, unknown>) => boolean,
		timeoutMs?: number,
	): Promise<Record<string, unknown>>;
	/** Registers an auto-responder for `extension_ui_request` dialog frames. */
	onUiRequest(
		handler: (req: Record<string, unknown>) => Record<string, unknown> | null,
	): void;
	/** Appends a free-form note to the sidecar metadata. */
	note(text: string): void;
	sleep(ms: number): Promise<void>;
}

interface Scenario {
	name: string;
	description: string;
	/** Extra pi CLI args beyond `--mode rpc --no-session`. */
	extraArgs?: string[];
	/** Extra files seeded into the sandbox, relative path → content. */
	extraFiles?: Record<string, string>;
	run(session: Session): Promise<void>;
}

/** Seed project files shared by every scenario sandbox. */
const SEED_FILES: Record<string, string> = {
	'package.json': `${JSON.stringify(
		{
			name: 'pi-capture-sandbox',
			version: '0.0.0',
			private: true,
			type: 'module',
		},
		null,
		'\t',
	)}\n`,
	'README.md': [
		'# Temperature Toolkit',
		'',
		'A tiny demo library for converting and classifying temperatures.',
		'',
		'- `src/index.ts` exposes the public API.',
		'- `src/convert.ts` converts between Celsius and Fahrenheit.',
		'- `src/classify.ts` buckets a temperature into cold/mild/hot.',
		'- `src/broken.ts` is known to contain a type error.',
		'',
		'Run `tsc --noEmit` to type-check.',
		'',
	].join('\n'),
	'tsconfig.json': `${JSON.stringify(
		{
			compilerOptions: {
				strict: true,
				module: 'esnext',
				target: 'es2022',
				moduleResolution: 'bundler',
				noEmit: true,
			},
			include: ['src'],
		},
		null,
		'\t',
	)}\n`,
	'src/convert.ts': [
		'/** Converts degrees Celsius to Fahrenheit. */',
		'export function celsiusToFahrenheit(celsius: number): number {',
		'\treturn celsius * (9 / 5) + 32;',
		'}',
		'',
		'/** Converts degrees Fahrenheit to Celsius. */',
		'export function fahrenheitToCelsius(fahrenheit: number): number {',
		'\treturn (fahrenheit - 32) * (5 / 9);',
		'}',
		'',
	].join('\n'),
	'src/classify.ts': [
		"export type TemperatureBand = 'cold' | 'mild' | 'hot';",
		'',
		'/** Buckets a Celsius temperature into a coarse band. */',
		'export function classify(celsius: number): TemperatureBand {',
		"\tif (celsius < 10) return 'cold';",
		"\tif (celsius < 25) return 'mild';",
		"\treturn 'hot';",
		'}',
		'',
	].join('\n'),
	'src/broken.ts': [
		"import { classify } from './classify.ts';",
		'',
		'// BUG: classify expects a number; this passes a string on purpose.',
		"export const verdict = classify('21');",
		'',
	].join('\n'),
	'src/index.ts': [
		"export { celsiusToFahrenheit, fahrenheitToCelsius } from './convert.ts';",
		"export { classify } from './classify.ts';",
		'',
	].join('\n'),
};

/** Project-level pi extension that gates bash behind a confirm dialog. */
const APPROVAL_GATE_EXTENSION = [
	"import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';",
	'',
	'export default function (pi: ExtensionAPI) {',
	"\tpi.on('tool_call', async (event, ctx) => {",
	"\t\tif (event.toolName !== 'bash') return;",
	"\t\tconst command = String((event.input as { command?: unknown }).command ?? '');",
	"\t\tconst ok = await ctx.ui.confirm('Approve bash command?', command);",
	"\t\tif (!ok) return { block: true, reason: 'Denied by user' };",
	'\t});',
	'}',
	'',
].join('\n');

/** Waits until `agent_end` arrives, the universal turn-complete signal. */
function agentEnd(session: Session, timeoutMs?: number) {
	return session.waitFor(
		'agent_end',
		(frame) => frame.type === 'agent_end',
		timeoutMs,
	);
}

const SCENARIOS: Scenario[] = [
	{
		name: 'plain-answer',
		description: 'Pure streamed assistant text, no tools.',
		async run(s) {
			s.send({
				type: 'prompt',
				message:
					'What is a Git worktree? Answer in one short paragraph of plain prose. Do not use any tools.',
			});
			await agentEnd(s);
		},
	},
	{
		name: 'markdown-heavy',
		description: 'Markdown rendering edge cases: headings, table, code.',
		async run(s) {
			s.send({
				type: 'prompt',
				message:
					'Explain React Server Components. Use markdown with at least two heading levels, a comparison table (server vs client components), one tsx code block, and one bash code block. Do not use any tools.',
			});
			await agentEnd(s);
		},
	},
	{
		name: 'single-read',
		description: 'One tool call with small output.',
		async run(s) {
			s.send({
				type: 'prompt',
				message: 'Read README.md and summarize it in two sentences.',
			});
			await agentEnd(s);
		},
	},
	{
		name: 'multi-tool-chain',
		description: 'Consecutive sequential tool calls.',
		async run(s) {
			s.send({
				type: 'prompt',
				message:
					'Find every .ts file in this project, read each of them, and then describe the project structure.',
			});
			await agentEnd(s);
		},
	},
	{
		name: 'long-output',
		description: 'Very long tool output; surfaces truncation behavior.',
		async run(s) {
			s.send({
				type: 'prompt',
				message:
					'Use the bash tool to run exactly this command: seq 1 500. Then tell me the last number printed.',
			});
			await agentEnd(s);
		},
	},
	{
		name: 'file-edit',
		description: 'Edit/diff events.',
		async run(s) {
			s.send({
				type: 'prompt',
				message: 'Fix the type error in src/broken.ts.',
			});
			await agentEnd(s);
		},
	},
	{
		name: 'failing-tool',
		description: 'Tool error / non-zero exit representation.',
		async run(s) {
			s.send({
				type: 'prompt',
				message:
					'Use the bash tool to run exactly this command: definitely-not-a-real-command-xyz. Report what happened.',
			});
			await agentEnd(s);
		},
	},
	{
		name: 'multi-turn',
		description: 'Two sequential prompts in one session.',
		async run(s) {
			s.send({
				type: 'prompt',
				message:
					'Read README.md and tell me what this project does in one sentence.',
			});
			await agentEnd(s);
			s.send({
				type: 'prompt',
				message:
					'Based on that, suggest one concrete improvement to the README. Do not read any files.',
			});
			await agentEnd(s);
		},
	},
	{
		name: 'thinking',
		description: 'Extended reasoning blocks, if the model emits them.',
		async run(s) {
			s.send({ type: 'set_thinking_level', level: 'high' });
			await s.waitFor(
				'set_thinking_level response',
				(frame) =>
					frame.type === 'response' && frame.command === 'set_thinking_level',
			);
			s.send({
				type: 'prompt',
				message:
					'Without using any tools: a farmer must ferry a wolf, a goat, and a cabbage across a river in a boat that fits only one item at a time. Work out a correct sequence, then explain in two sentences why no shorter sequence exists.',
			});
			await agentEnd(s);
		},
	},
	{
		name: 'abort-mid-turn',
		description: 'Abort RPC mid-stream; cancellation events, partial content.',
		async run(s) {
			s.send({
				type: 'prompt',
				message:
					'Read every file in this project one at a time, then write a very detailed multi-section analysis of the entire codebase, file by file.',
			});
			await s.waitFor(
				'first tool_execution_start or text delta',
				(frame) =>
					frame.type === 'tool_execution_start' ||
					(frame.type === 'message_update' &&
						(frame.assistantMessageEvent as { type?: string } | undefined)
							?.type === 'text_delta'),
			);
			await s.sleep(750);
			s.send({ type: 'abort' });
			s.note('abort sent 750ms after first tool/text activity');
			await agentEnd(s, 30_000);
		},
	},
	{
		name: 'permission-gate',
		description:
			'Extension UI confirm handshake: approve once, then deny once.',
		// Explicit -e load: project-dir extension discovery alone did not fire
		// the confirm dialog during capture, even with -a.
		extraArgs: ['-a', '-e', '.pi/agent/extensions/approval-gate.ts'],
		extraFiles: {
			'.pi/agent/extensions/approval-gate.ts': APPROVAL_GATE_EXTENSION,
		},
		async run(s) {
			const answers: boolean[] = [true, false];
			s.onUiRequest((req) => {
				if (req.method !== 'confirm') return null;
				const confirmed = answers.shift();
				if (confirmed === undefined) return null;
				s.note(
					`responded to confirm "${String(req.title)}" with confirmed=${confirmed}`,
				);
				return { type: 'extension_ui_response', id: req.id, confirmed };
			});
			s.send({
				type: 'prompt',
				message:
					'Use the bash tool to run exactly this command: echo approved-run.',
			});
			await agentEnd(s);
			s.send({
				type: 'prompt',
				message:
					'Use the bash tool to run exactly this command: echo denied-run. If the tool is blocked, say so and stop.',
			});
			await agentEnd(s);
		},
	},
	{
		name: 'unicode-and-ansi',
		description: 'Emoji and ANSI color codes inside tool output.',
		async run(s) {
			s.send({
				type: 'prompt',
				message:
					"Use the bash tool to run exactly this command: printf '\\033[31mRED\\033[0m \\033[1;32mBOLD GREEN\\033[0m 🎉 ✅ café\\n'. Then repeat the visible text back to me.",
			});
			await agentEnd(s);
		},
	},
];

/**
 * Streams a child stdio pipe, splitting on LF only per the RPC framing rules
 * (strip one trailing CR; never split on U+2028/U+2029).
 */
async function readJsonlStream(
	stream: ReadableStream<Uint8Array>,
	onLine: (line: string) => void,
): Promise<void> {
	const decoder = new TextDecoder();
	let buffer = '';
	for await (const chunk of stream) {
		buffer += decoder.decode(chunk, { stream: true });
		let newlineIndex = buffer.indexOf('\n');
		while (newlineIndex !== -1) {
			let line = buffer.slice(0, newlineIndex);
			buffer = buffer.slice(newlineIndex + 1);
			if (line.endsWith('\r')) line = line.slice(0, -1);
			onLine(line);
			newlineIndex = buffer.indexOf('\n');
		}
	}
	buffer += decoder.decode();
	if (buffer.length > 0) {
		onLine(buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer);
	}
}

/** Seeds a fresh sandbox project directory for one scenario. */
function seedSandbox(scenario: Scenario): string {
	const dir = join(SANDBOX_ROOT, scenario.name);
	rmSync(dir, { recursive: true, force: true });
	const files = { ...SEED_FILES, ...scenario.extraFiles };
	for (const [relPath, content] of Object.entries(files)) {
		const target = join(dir, relPath);
		mkdirSync(join(target, '..'), { recursive: true });
		writeFileSync(target, content);
	}
	return dir;
}

/** Runs one scenario end to end and writes its fixture plus sidecar. */
async function captureScenario(scenario: Scenario): Promise<void> {
	const cwd = seedSandbox(scenario);
	const fixturePath = join(FIXTURE_DIR, `${scenario.name}.jsonl`);
	const metaPath = join(FIXTURE_DIR, `${scenario.name}.meta.json`);
	writeFileSync(fixturePath, '');

	const piArgs = [
		'--mode',
		'rpc',
		'--no-session',
		...(scenario.extraArgs ?? []),
	];
	const meta: ScenarioMeta = {
		scenario: scenario.name,
		description: scenario.description,
		piArgs,
		cwd,
		startedAt: Date.now(),
		endedAt: 0,
		sent: [],
		exitCondition: 'unknown',
		exitCode: null,
		notes: [],
	};

	console.log(`▶ ${scenario.name}`);
	const proc = Bun.spawn(['pi', ...piArgs], {
		cwd,
		stdin: 'pipe',
		stdout: 'pipe',
		stderr: 'pipe',
	});

	type Waiter = {
		label: string;
		pred: (frame: Record<string, unknown>) => boolean;
		resolve: (frame: Record<string, unknown>) => void;
	};
	const waiters: Waiter[] = [];
	let uiHandler:
		| ((req: Record<string, unknown>) => Record<string, unknown> | null)
		| null = null;

	const session: Session = {
		send(command) {
			meta.sent.push({ ts: Date.now(), command });
			proc.stdin.write(`${JSON.stringify(command)}\n`);
			proc.stdin.flush();
		},
		waitFor(label, pred, timeoutMs = DEFAULT_STEP_TIMEOUT_MS) {
			return new Promise((resolve, reject) => {
				const waiter: Waiter = { label, pred, resolve };
				waiters.push(waiter);
				setTimeout(() => {
					const index = waiters.indexOf(waiter);
					if (index !== -1) {
						waiters.splice(index, 1);
						reject(new Error(`timeout waiting for ${label}`));
					}
				}, timeoutMs);
			});
		},
		onUiRequest(handler) {
			uiHandler = handler;
		},
		note(text) {
			meta.notes.push(text);
		},
		sleep(ms) {
			return new Promise((resolve) => setTimeout(resolve, ms));
		},
	};

	const record = (stream: 'stdout' | 'stderr') => (line: string) => {
		appendFileSync(
			fixturePath,
			`${JSON.stringify({
				ts: Date.now(),
				stream,
				raw: sanitizeCapturedText(line),
			})}\n`,
		);
		if (stream !== 'stdout') return;
		let frame: Record<string, unknown>;
		try {
			frame = JSON.parse(line) as Record<string, unknown>;
		} catch {
			return;
		}
		if (frame.type === 'extension_ui_request' && uiHandler) {
			const response = uiHandler(frame);
			if (response) session.send(response);
		}
		for (let i = 0; i < waiters.length; i += 1) {
			const waiter = waiters[i];
			if (waiter.pred(frame)) {
				waiters.splice(i, 1);
				waiter.resolve(frame);
				i -= 1;
			}
		}
	};

	const stdoutDone = readJsonlStream(proc.stdout, record('stdout'));
	const stderrDone = readJsonlStream(proc.stderr, record('stderr'));

	try {
		await scenario.run(session);
		// Capture status-bar data (tokens, cost, context usage) before exit.
		session.send({ id: 'final-stats', type: 'get_session_stats' });
		await session.waitFor(
			'final get_session_stats response',
			(frame) => frame.type === 'response' && frame.id === 'final-stats',
			15_000,
		);
		meta.exitCondition = 'completed';
	} catch (error) {
		meta.exitCondition = `error: ${error instanceof Error ? error.message : String(error)}`;
		console.error(`  ✖ ${meta.exitCondition}`);
	}

	proc.kill('SIGTERM');
	meta.exitCode = await proc.exited;
	await Promise.allSettled([stdoutDone, stderrDone]);
	meta.endedAt = Date.now();
	writeFileSync(
		metaPath,
		`${sanitizeCapturedText(JSON.stringify(meta, null, '\t'))}\n`,
	);
	console.log(
		`  ✔ ${meta.exitCondition} (exit ${meta.exitCode}) → ${fixturePath}`,
	);
}

const requested = process.argv.slice(2);
const selected =
	requested.length > 0
		? SCENARIOS.filter((scenario) => requested.includes(scenario.name))
		: SCENARIOS;
if (requested.length > 0 && selected.length !== requested.length) {
	const known = new Set(SCENARIOS.map((scenario) => scenario.name));
	const unknown = requested.filter((name) => !known.has(name));
	console.error(`Unknown scenario(s): ${unknown.join(', ')}`);
	process.exit(1);
}

mkdirSync(FIXTURE_DIR, { recursive: true });
for (const scenario of selected) {
	await captureScenario(scenario);
}
console.log('done');

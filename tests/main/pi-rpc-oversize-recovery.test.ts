import assert from 'node:assert/strict';
import test from 'node:test';

import { recoverToolCompletion } from '../../src/main/pi-agent/cli-rpc/discarded-frame.ts';
import { createPiRpcLineStream } from '../../src/main/pi-agent/cli-rpc/line-stream-handlers.ts';
import { normalizeToolExecutionFrame } from '../../src/main/pi-agent/pi-wire-normalizer.ts';

const TOOL_CALL_ID = `call_2KaGMgQzDCSRy5gaQNAjV2ob|fc_${'0'.repeat(48)}`;

/**
 * Builds a line stream wired the way the adapter wires it, capturing frames
 * and errors instead of emitting them.
 */
function createHarness(maxLineBytes = 512) {
	const frames: unknown[] = [];
	const errors: Array<{ detail?: string; message: string }> = [];
	const stream = createPiRpcLineStream({
		emitError: (_code, message, detail) => errors.push({ detail, message }),
		maxLineBytes,
		onFrame: (frame) => frames.push(frame),
		onRawLine: () => undefined,
	});
	return { errors, frames, stream };
}

/** Produces an oversize JSONL line whose head names the finished tool call. */
function oversizeToolResultLine(head: string): string {
	return `${head}${'A'.repeat(2048)}"}]}}\n`;
}

test('recovers a tool completion from a discarded tool_execution_end', () => {
	const recovered = recoverToolCompletion(
		`{"type":"tool_execution_end","toolCallId":"${TOOL_CALL_ID}","toolName":"read","result":{"con`,
		'discarded',
	);

	assert.deepEqual(recovered, {
		isError: true,
		result: { content: [{ text: 'discarded', type: 'text' }] },
		toolCallId: TOOL_CALL_ID,
		type: 'tool_execution_end',
	});
});

test('does not recover a completion from a discarded toolResult message', () => {
	for (const frameType of ['message_start', 'message_end']) {
		assert.equal(
			recoverToolCompletion(
				`{"type":"${frameType}","message":{"role":"toolResult","toolCallId":"${TOOL_CALL_ID}","content"`,
				'discarded',
			),
			null,
		);
	}
});

test('does not recover a completion from a discarded tool call', () => {
	assert.equal(
		recoverToolCompletion(
			`{"type":"tool_execution_start","toolCallId":"${TOOL_CALL_ID}","toolName":"write","args":{"con`,
			'discarded',
		),
		null,
	);
});

test('does not recover a completion when the id was truncated away', () => {
	assert.equal(
		recoverToolCompletion(
			'{"type":"tool_execution_end","toolCallId":"call_2KaGMgQzDC',
			'discarded',
		),
		null,
	);
});

test('settles the running tool when its result line is discarded', () => {
	const { errors, frames, stream } = createHarness();

	stream.feed(
		`{"type":"tool_execution_start","toolCallId":"${TOOL_CALL_ID}","toolName":"read","args":{"path":"board.webp"}}\n`,
	);
	stream.feed(
		oversizeToolResultLine(
			`{"type":"tool_execution_end","toolCallId":"${TOOL_CALL_ID}","isError":false,"result":{"content":[{"type":"text","text":"`,
		),
	);

	assert.equal(errors.length, 1);
	assert.match(errors[0]?.message ?? '', /Discarded oversize Pi RPC line/);
	assert.equal(frames.length, 2);

	const settled = normalizeToolExecutionFrame(
		frames[1] as Record<string, unknown>,
	);
	assert.equal(settled.kind, 'tool-result');
	assert.equal(
		settled.kind === 'tool-result' ? settled.toolCallId : null,
		TOOL_CALL_ID,
	);
	assert.equal(settled.kind === 'tool-result' ? settled.isError : null, true);
});

test('leaves a delivered result alone when only its message echo is discarded', () => {
	const { errors, frames, stream } = createHarness();

	stream.feed(
		`{"type":"tool_execution_end","toolCallId":"${TOOL_CALL_ID}","toolName":"read","result":{"content":[{"type":"text","text":"ok"}]},"isError":false}\n`,
	);
	stream.feed(
		oversizeToolResultLine(
			`{"type":"message_end","message":{"role":"toolResult","toolCallId":"${TOOL_CALL_ID}","toolName":"read","content":[{"type":"text","text":"`,
		),
	);

	assert.equal(errors.length, 1);
	assert.equal(frames.length, 1);
	assert.equal((frames[0] as { isError: boolean }).isError, false);
});

test('settles a lost result exactly once despite Pi reporting it three ways', () => {
	const { frames, stream } = createHarness();

	for (const head of [
		`{"type":"tool_execution_end","toolCallId":"${TOOL_CALL_ID}","toolName":"read","result":{"content":[{"type":"text","text":"`,
		`{"type":"message_start","message":{"role":"toolResult","toolCallId":"${TOOL_CALL_ID}","toolName":"read","content":[{"type":"text","text":"`,
		`{"type":"message_end","message":{"role":"toolResult","toolCallId":"${TOOL_CALL_ID}","toolName":"read","content":[{"type":"text","text":"`,
	]) {
		stream.feed(oversizeToolResultLine(head));
	}

	assert.equal(frames.length, 1);
	assert.equal((frames[0] as { toolCallId: string }).toolCallId, TOOL_CALL_ID);
});

test('keeps the oversize error detail short enough to read', () => {
	const { errors, stream } = createHarness();

	stream.feed(
		oversizeToolResultLine(
			`{"type":"tool_execution_end","toolCallId":"${TOOL_CALL_ID}","result":{"content":[{"type":"text","text":"`,
		),
	);

	assert.ok((errors[0]?.detail?.length ?? 0) <= 128);
});

test('leaves a discarded non-tool line without a synthetic frame', () => {
	const { errors, frames, stream } = createHarness();

	stream.feed(
		`{"type":"agent_end","turnId":"t1","payload":"${'A'.repeat(2048)}"}\n`,
	);

	assert.equal(errors.length, 1);
	assert.deepEqual(frames, []);
});

import type { DynamicToolUIPart } from 'ai';
import { formatTurnDuration } from '@/renderer/lib/format-duration';
import { i18n } from '@/renderer/lib/i18n';
import {
	bold,
	type ControlRow,
	codeFence,
	codeSpan,
	controlAck,
	controlPayloadRecord,
	isRecord,
	joinFacts,
	markdownBlocks,
	markdownRow,
	numberValue,
	stringValue,
	waitEndingFact,
} from './ensemblr-control-presenter-helpers';

/**
 * How the compute-queue control ops read once a row is opened: each job's
 * outcome, the end of what it printed, and where the whole log lives. The
 * title and glyph stay with `ensemblr-control-tool-registry.ts`; this supplies
 * the body and the collapsed preview, which surfaces what came back — the exit
 * code or where the job stands — rather than repeating the command.
 */

/** Characters of a job's output tail the row shows; the agent got more. */
const ROW_TAIL_LIMIT = 4_000;

/**
 * Names a job state in the active language.
 * @param state - The job's untrusted `state` field
 * @returns The label, or null for a state this family does not know
 */
function stateLabel(state: string | null): string | null {
	switch (state) {
		case 'queued':
			return i18n.t('workbench:control-tool.job.state.queued', 'queued');
		case 'running':
			return i18n.t('workbench:control-tool.job.state.running', 'running');
		case 'succeeded':
			return i18n.t('workbench:control-tool.job.state.succeeded', 'succeeded');
		case 'failed':
			return i18n.t('workbench:control-tool.job.state.failed', 'failed');
		case 'cancelled':
			return i18n.t('workbench:control-tool.job.state.cancelled', 'cancelled');
		default:
			return null;
	}
}

/**
 * The one-line verdict on a job: its state, and its exit code or queue place.
 * @param job - One untrusted `QueuedJobReport`
 * @returns The verdict facts joined
 */
function jobVerdict(job: Record<string, unknown>): string {
	const exitCode = numberValue(job, 'exitCode');
	const position = numberValue(job, 'position');
	const durationMs = numberValue(job, 'durationMs');
	return joinFacts([
		stateLabel(stringValue(job, 'state')),
		exitCode === null
			? null
			: i18n.t('workbench:control-tool.job.exit-code', 'exit {{code}}', {
					code: exitCode,
				}),
		position === null
			? null
			: i18n.t('workbench:control-tool.job.position', 'position {{position}}', {
					position,
				}),
		durationMs === null ? null : formatTurnDuration(durationMs),
	]);
}

/**
 * Renders one job: its label and verdict, the command, the end of its output,
 * and where the full log is.
 * @param job - One untrusted `QueuedJobReport`
 * @returns The rendered block, or null when the row carries no job id
 */
function jobBlock(job: unknown): string | null {
	if (!isRecord(job) || stringValue(job, 'jobId') === null) {
		return null;
	}
	const label = stringValue(job, 'label') ?? stringValue(job, 'jobId') ?? '';
	const command = stringValue(job, 'command');
	const tail = typeof job.outputTail === 'string' ? job.outputTail : '';
	const logPath = stringValue(job, 'logPath');
	return markdownBlocks([
		`${bold(label)} — ${jobVerdict(job)}`,
		command === null || command === label ? null : codeSpan(command),
		tail.trim().length === 0 ? null : codeFence(tail.slice(-ROW_TAIL_LIMIT)),
		logPath === null
			? null
			: i18n.t('workbench:control-tool.job.log', 'Full log: {{path}}', {
					path: codeSpan(logPath),
				}),
	]);
}

/**
 * Reads the job rows a result carries under one field.
 * @param payload - The op's payload
 * @param field - `settled` or `pending`
 * @returns The rows, empty when the field is missing
 */
function jobRows(
	payload: Record<string, unknown>,
	field: 'pending' | 'settled',
): readonly unknown[] {
	const rows = payload[field];
	return Array.isArray(rows) ? rows : [];
}

/**
 * Renders a list of jobs, dropping any row without an id.
 * @param jobs - Untrusted job rows
 * @returns The rendered blocks joined, or null when none rendered
 */
function jobBlocks(jobs: readonly unknown[]): string | null {
	const blocks = jobs.flatMap((job) => {
		const block = jobBlock(job);
		return block === null ? [] : [block];
	});
	return blocks.length === 0 ? null : blocks.join('\n\n');
}

/**
 * Presents a queued command: its outcome once it finished, or where it stands.
 * @param part - The `ensemblr_run_queued` tool part to project
 * @returns The row's body and collapsed summary
 */
function presentRunQueued(part: DynamicToolUIPart): ControlRow {
	const payload = controlPayloadRecord(part);
	if (payload === null || !isRecord(payload.job)) {
		return controlAck();
	}
	return markdownRow(
		markdownBlocks([jobBlock(payload.job), stringValue(payload, 'note')]),
		joinFacts([jobVerdict(payload.job), waitEndingFact(payload)]),
	);
}

/**
 * Presents a wait on queued jobs: the finished ones with their output, and the
 * ones still queued or running.
 * @param part - The `ensemblr_wait_for_job` tool part to project
 * @returns The row's body and collapsed summary
 */
function presentWaitForJob(part: DynamicToolUIPart): ControlRow {
	const payload = controlPayloadRecord(part);
	if (payload === null) {
		return controlAck();
	}
	const settled = jobRows(payload, 'settled');
	const pending = jobRows(payload, 'pending');
	const settledBlocks = jobBlocks(settled);
	const pendingBlocks = jobBlocks(pending);
	return markdownRow(
		markdownBlocks([
			settledBlocks === null
				? null
				: markdownBlocks([
						`### ${i18n.t('workbench:control-tool.wait.settled-heading', 'Settled')}`,
						settledBlocks,
					]),
			pendingBlocks === null
				? null
				: markdownBlocks([
						`### ${i18n.t('workbench:control-tool.job.pending-heading', 'Still queued or running')}`,
						pendingBlocks,
					]),
			stringValue(payload, 'note'),
		]),
		joinFacts([
			settled.length === 0
				? null
				: i18n.t('workbench:control-tool.preview.jobs-settled', {
						count: settled.length,
						defaultValue_one: '{{count}} job finished',
						defaultValue_other: '{{count}} jobs finished',
					}),
			pending.length === 0
				? null
				: i18n.t('workbench:control-tool.preview.jobs-pending', {
						count: pending.length,
						defaultValue_one: '{{count}} job still going',
						defaultValue_other: '{{count}} jobs still going',
					}),
			waitEndingFact(payload),
		]),
	);
}

/**
 * Presents a cancellation: whether it took, and the job as it now stands.
 * @param part - The `ensemblr_cancel_job` tool part to project
 * @returns The row's body and collapsed summary
 */
function presentCancelJob(part: DynamicToolUIPart): ControlRow {
	const payload = controlPayloadRecord(part);
	if (payload === null) {
		return controlAck();
	}
	return markdownRow(
		jobBlock(payload.job) ?? '',
		payload.cancelled === true
			? i18n.t('workbench:control-tool.job.cancelled', 'cancelled')
			: i18n.t(
					'workbench:control-tool.job.nothing-to-cancel',
					'already finished',
				),
	);
}

/** Compute-queue control ops, keyed by their canonical tool name. */
export const ENSEMBLR_JOB_TOOL_PRESENTERS: Record<
	string,
	(part: DynamicToolUIPart) => ControlRow
> = {
	ensemblr_cancel_job: presentCancelJob,
	ensemblr_run_queued: presentRunQueued,
	ensemblr_wait_for_job: presentWaitForJob,
};

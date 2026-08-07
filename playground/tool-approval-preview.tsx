import { useState } from 'react';

import { ToolApprovalCard } from '@/renderer/components/tool-approval';
import type {
	ToolApprovalDecision,
	ToolApprovalRequestedBroadcast,
} from '@/shared/agent-tool-approval';

/** The three shapes of prompt the card has to read well in. */
const REQUESTS: readonly ToolApprovalRequestedBroadcast[] = [
	{
		agentSessionId: 'session-1',
		input: {
			command: 'rm -rf node_modules && npm install',
			description: 'reinstall dependencies',
			timeout: '120000',
		},
		requestId: 'req-bash',
		toolName: 'Bash',
	},
	{
		agentSessionId: 'session-1',
		displayName: 'Edit file',
		input: {
			file_path: '/Users/me/code/ensemblr/src/main/claude-agent/index.ts',
			replace_all: 'false',
		},
		requestId: 'req-edit',
		title: 'Claude wants to edit index.ts',
		toolName: 'Edit',
	},
	{
		agentSessionId: 'session-1',
		description: 'Claude will have read access to files under ~/Downloads.',
		displayName: 'Read file',
		input: { file_path: '~/Downloads/report.csv' },
		requestId: 'req-read',
		title: 'Claude wants to read report.csv',
		toolName: 'Read',
	},
];

/**
 * The per-tool approval card in the composer slot, driven by the same broadcast
 * shape main sends. Clicking a decision records it so the wiring is visible
 * without an Electron runtime behind it.
 */
export function ToolApprovalScene() {
	const [index, setIndex] = useState(0);
	const [decisions, setDecisions] = useState<readonly string[]>([]);
	const request = REQUESTS[index] ?? REQUESTS[0];

	if (!request) {
		return null;
	}

	const record = (decision: ToolApprovalDecision) => {
		const reason = decision.kind === 'deny' ? (decision.reason ?? '') : '';
		setDecisions((previous) => [
			...previous,
			`${request.toolName} → ${decision.kind}${reason ? ` (${reason})` : ''}`,
		]);
	};

	return (
		<div className='flex flex-col gap-4'>
			<div className='flex flex-wrap items-center gap-1'>
				{REQUESTS.map((candidate, candidateIndex) => (
					<button
						className='rounded-md border border-transparent px-2 py-1 font-mono text-muted-foreground text-xxs hover:bg-accent/50 aria-pressed:border-border aria-pressed:bg-surface aria-pressed:text-foreground'
						aria-pressed={candidateIndex === index}
						key={candidate.requestId}
						onClick={() => setIndex(candidateIndex)}
						type='button'
					>
						{candidate.toolName}
					</button>
				))}
			</div>

			<ToolApprovalCard
				key={request.requestId}
				onDecide={record}
				request={request}
			/>

			<ul
				aria-label='Recorded decisions'
				className='flex flex-col gap-1 font-mono text-muted-foreground text-xs'
			>
				{decisions.map((entry, entryIndex) => (
					<li key={`${entry}-${entryIndex}`}>{entry}</li>
				))}
			</ul>
		</div>
	);
}

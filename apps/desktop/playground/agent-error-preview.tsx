import type { UIMessage } from 'ai';
import { useMemo, useState } from 'react';

import { ChatAssistantTurn } from '@/renderer/components/chat-assistant-turn';
import { RuntimeErrorRow } from '@/renderer/components/workbench-shell/conversation-panel/timeline/runtime-error-row';
import { agentFailureClassOf } from '@/renderer/lib/agent-failure-text';
import { AGENT_FAILURE_CLASSES } from '@/shared/agent-failure';
import type { AgentWireError } from '@/shared/ipc/contracts/agent-session';

import { AGENT_ERROR_FIXTURES } from './agent-error-fixtures.ts';
import {
	ControlGroup,
	SceneControls,
	SceneSection,
	SceneToggle,
} from './scene-chrome.tsx';

/** A truncated answer, so the incomplete marker has something to close. */
const CUT_OFF_TURN: UIMessage = {
	id: 'turn-1',
	parts: [
		{
			state: 'done',
			text: 'The migration touches four call sites. The first is `src/main/storage/database.ts`, where the schema version needs a new numbered migration; the second is the repository module that reads the column, which currently assumes it is non-null. The third is',
			type: 'text',
		},
	],
	role: 'assistant',
};

/** Turn timing the scene never animates — the turn is settled and failed. */
const SETTLED_TIMING = { endMs: 1_000, startMs: 0 };

/**
 * One failure per class in the taxonomy, driven off `AGENT_FAILURE_CLASSES`
 * rather than off the fixture list — a class the fixtures do not cover yet is
 * shown as a pre-tagged synthetic error instead of being silently dropped, so
 * the catalogue below cannot stop being a catalogue.
 * @returns An error per class, in taxonomy order
 */
function everyFailureClass(): readonly AgentWireError[] {
	const byClass = new Map(
		AGENT_ERROR_FIXTURES.map((fixture) => [
			agentFailureClassOf(fixture.error),
			fixture.error,
		]),
	);
	return AGENT_FAILURE_CLASSES.map(
		(failureClass) =>
			byClass.get(failureClass) ?? {
				failureClass,
				message: `No fixture yet for ${failureClass}.`,
			},
	);
}

/**
 * The designed runtime-error row, driven by real provider strings rather than
 * hand-picked classes: every fixture goes through the shipped
 * `classifyAgentFailure`, so what the canvas shows is what the timeline will
 * show for that exact sentence — including which recoveries the class earns.
 *
 * Shown at the transcript's real `max-w-3xl` column, because the action row
 * wraps very differently there than across a full canvas.
 */
export function AgentErrorScene() {
	const [label, setLabel] = useState(AGENT_ERROR_FIXTURES[0].label);
	const selected = useMemo(
		() =>
			AGENT_ERROR_FIXTURES.find((entry) => entry.label === label) ??
			AGENT_ERROR_FIXTURES[0],
		[label],
	);

	return (
		<div className='flex flex-col gap-8'>
			<SceneControls>
				<ControlGroup label='runtime failure'>
					{AGENT_ERROR_FIXTURES.map((entry) => (
						<SceneToggle
							isActive={entry.label === label}
							key={entry.label}
							label={entry.label}
							onClick={() => setLabel(entry.label)}
						/>
					))}
				</ControlGroup>
			</SceneControls>

			<SceneSection
				label={`Error row — ${agentFailureClassOf(selected.error)}`}
				note='The provider’s own sentence is never the headline: it is demoted into “Runtime detail”, and a detail that parses as a stack trace gets the frame viewer instead of a plain block. Buttons render only for the recoveries the class earns.'
			>
				<div className='max-w-3xl'>
					<RuntimeErrorRow
						failure={selected.error}
						handlers={PLAYGROUND_HANDLERS}
					/>
				</div>
			</SceneSection>

			<SceneSection
				label='After a cut-off turn'
				note='What the observed bug actually looks like end to end: the truncated answer is marked as cut short rather than left reading as finished, and the row underneath says why and offers Continue.'
			>
				<div className='flex max-w-3xl flex-col gap-6'>
					<ChatAssistantTurn
						isIncomplete
						isStreaming={false}
						message={CUT_OFF_TURN}
						timing={SETTLED_TIMING}
					/>
					<RuntimeErrorRow
						failure={AGENT_ERROR_FIXTURES[0].error}
						handlers={PLAYGROUND_HANDLERS}
					/>
				</div>
			</SceneSection>

			<SceneSection
				label='Every class'
				note='The whole taxonomy at once, enumerated from AGENT_FAILURE_CLASSES — for checking that severity, icon, copy length, and the no-button case stay consistent across classes in both themes.'
			>
				<div className='flex max-w-3xl flex-col gap-3'>
					{everyFailureClass().map((failure) => (
						<RuntimeErrorRow
							failure={failure}
							handlers={PLAYGROUND_HANDLERS}
							key={agentFailureClassOf(failure)}
						/>
					))}
				</div>
			</SceneSection>
		</div>
	);
}

/**
 * Recoveries wired to nothing: the scene reviews which buttons a class shows,
 * not what they do. All four are supplied so no button is hidden for want of a
 * handler.
 */
const PLAYGROUND_HANDLERS = {
	onContinue: () => undefined,
	onEditPrompt: () => undefined,
	onFork: () => undefined,
	onOpenPermissions: () => undefined,
	onOpenProviderSettings: () => undefined,
	onRetry: () => undefined,
};

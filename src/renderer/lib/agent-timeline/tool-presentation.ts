import type { DynamicToolUIPart } from 'ai';
import { i18n } from '@/renderer/lib/i18n';
import type { PiCustomMessageData } from '@/renderer/types/agent-timeline';
import type {
	ToolGlyph,
	ToolPresentation,
} from '@/renderer/types/tool-presentation';
import {
	canonicalEnsemblrToolName,
	ensemblrControlFailure,
	ensemblrToolLabel,
} from './ensemblr-tool-presentation';
import { looksLikeStackTrace } from './tool-output-classifier';
import { inputOf, outputOf } from './tool-part-fields';
import { presenterFor, restingGlyph } from './tool-presenters';

/**
 * Turning one recorded timeline entry into the row the conversation renders.
 *
 * This module decides what kind of row a call is — failed, still running, one of
 * the app's own control tools, or an ordinary tool the presenters in
 * `tool-presenters.ts` know how to shape — and projects the non-tool entries a
 * turn also carries: reasoning, an injected message, a skill activation.
 */

/** Tool states that still represent work in flight rather than a result. */
const RUNNING_STATES = new Set(['input-streaming', 'input-available']);

/**
 * Turns a raw tool name into a title-cased, space-separated label.
 * @param name - The raw tool name
 * @returns The humanized label, or `'Tool'` when the name is empty
 */
function humanizeToolName(name: string): string {
	const cleaned = name.replace(/[_-]+/g, ' ').trim();
	if (cleaned.length === 0) {
		return i18n.t('workbench:tool-call.generic.title', 'Tool');
	}
	return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Stands in when a failed call reported neither a reason nor any output.
 * @returns The generic failure line, in the active language.
 */
function unspecifiedFailure(): string {
	return i18n.t(
		'workbench:tool-call.failed.unspecified',
		'The call failed without a reported reason.',
	);
}

/**
 * Reads the message a failed call should render.
 *
 * A control tool reports a refusal as an ordinary result carrying `ok: false`
 * and never sets the transport's error text, so a row that trusts the error text
 * alone titles a denial as the action it was refused.
 * @param part - The tool part to inspect
 * @returns The failure message, or null when the call did not fail
 */
function failureTextOf(part: DynamicToolUIPart): string | null {
	if ('errorText' in part && part.errorText) {
		return part.errorText;
	}
	const controlFailure = ensemblrControlFailure(part);
	if (controlFailure === null) {
		return null;
	}
	const reported = controlFailure.error ?? outputOf(part)?.text ?? '';
	return reported.length > 0 ? reported : unspecifiedFailure();
}

/**
 * Projects any tool call into everything its row needs to render.
 *
 * Failures and in-flight calls short-circuit before the per-tool presenters:
 * a failed call reads the same whichever tool produced it, and a running one
 * has no result to shape yet. Otherwise a tool-specific presenter runs, falling
 * back to the generic extension shape for names the app does not know.
 *
 * A failure carrying a stack trace gets the frame-parsing viewer rather than a
 * flat block, so a several-hundred-line traceback collapses to its error line.
 * It is titled with the tool's name rather than the action, because the name is
 * what makes a denial diagnosable — a control tool's name shorn of the MCP
 * namespacing one runtime wraps it in, which identifies the server and not the
 * call that was refused.
 * @param part - The tool part to project
 * @returns The row's icon, title, badge, preview, and body
 */
export function presentToolCall(part: DynamicToolUIPart): ToolPresentation {
	const failureText = failureTextOf(part);
	if (failureText !== null) {
		return {
			badge: null,
			body: looksLikeStackTrace(failureText)
				? { kind: 'stack-trace', trace: failureText }
				: { kind: 'error', text: failureText },
			glyph: 'circle-x',
			preview: { font: 'mono', text: failureText },
			title: i18n.t('workbench:tool-call.failed.title', '{{tool}} failed', {
				tool: humanizeToolName(
					canonicalEnsemblrToolName(part.toolName) ?? part.toolName,
				),
			}),
			tone: 'destructive',
		};
	}
	const glyph = restingGlyph(part);
	const isRunning = RUNNING_STATES.has(part.state);
	const projected = presenterFor(part.toolName)(part);
	const controlLabel = ensemblrToolLabel(
		part.toolName,
		inputOf(part),
		isRunning,
	);
	const presentation = {
		...projected,
		badge: controlLabel?.badge ?? projected.badge,
		glyph: projected.glyph ?? glyph,
		title: controlLabel?.title ?? projected.title,
	};
	if (isRunning) {
		return { ...presentation, body: { kind: 'pending' } };
	}
	return presentation;
}

/**
 * Resolves the icon a tool call reads as, without projecting its body. A turn
 * summary paints one of these per call, so it must stay cheap on turns holding
 * dozens of them.
 * @param part - The tool part to identify
 * @returns The glyph for the tool, or the failure mark when the call failed
 */
export function glyphForToolCall(part: DynamicToolUIPart): ToolGlyph {
	return failureTextOf(part) === null ? restingGlyph(part) : 'circle-x';
}

/**
 * Projects a reasoning block into the same row shape as a tool call, so
 * thinking and acting read as one timeline rather than two styles.
 *
 * A runtime that redacts its reasoning — Claude Code ships the block's signature
 * and no text — leaves nothing to disclose, so it projects to nothing rather
 * than to a row titled "Thought" that opens onto an empty body. Answering with
 * null keeps that judgement here, where the shape of a reasoning row is already
 * decided, rather than in every caller that renders one.
 * @param text - The raw reasoning markdown
 * @returns The row presentation, or null when the block carries no prose
 */
export function presentReasoning(text: string): ToolPresentation | null {
	const prose = text.trim();
	if (prose.length === 0) {
		return null;
	}
	return {
		badge: null,
		body: { kind: 'markdown', text: prose },
		glyph: 'brain',
		preview: { font: 'sans', text: prose },
		title: i18n.t('workbench:tool-call.reasoning.title', 'Thinking'),
		tone: 'default',
	};
}

/**
 * Projects an extension-injected message into a row, so context an extension
 * pushed into the conversation announces itself without occupying the surface
 * the answer needs.
 *
 * An injector that set no `display` hint asked to stay out of the conversation,
 * so its row keeps the preview line empty: the title says something arrived,
 * and the payload waits behind the disclosure.
 * @param data - The injector's tag, visibility hint, and text
 * @returns The row presentation for the injected message
 */
export function presentCustomMessage(
	data: PiCustomMessageData,
): ToolPresentation {
	return {
		badge: null,
		body: { kind: 'markdown', text: data.text },
		glyph: 'puzzle',
		preview: data.display ? { font: 'sans', text: data.text } : null,
		title: humanizeToolName(data.customType),
		tone: 'default',
	};
}

/**
 * Projects a skill activation into a row, so a `/skill:name` invocation reads as
 * one line of turn activity naming the skill, rather than the whole `SKILL.md`
 * Pi expanded into the prompt. The body is empty: the skill's effect is the turn
 * that follows, not text to unfold.
 * @param name - The invoked skill's name
 * @returns The row presentation for the activation
 */
export function presentSkillInvocation(name: string): ToolPresentation {
	return {
		badge: null,
		body: { kind: 'empty' },
		glyph: 'biceps-flexed',
		preview: null,
		title: i18n.t('workbench:tool-call.skill.named', 'Skill: {{name}}', {
			name,
		}),
		tone: 'default',
	};
}

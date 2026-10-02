/**
 * Plan Mode's second enforcement seam on the Claude Code path.
 *
 * The first is `permissionMode: 'plan'`, and on its own it is not enough. Claude
 * runs its own `ExitPlanMode` and the CLI leaves plan mode as it does so,
 * without telling the adapter; nothing re-asserts until the user's next prompt,
 * so the rest of that turn runs at whatever the workspace mode grants — on a
 * `workspace-trusted` workspace, `bypassPermissions` with no `canUseTool` and no
 * hook in the path. A `permissions.allow` rule in the user's own
 * `~/.claude/settings.json` is the other way past a mode-level gate, and
 * `settingSources` loads those by design.
 *
 * So this is a `PreToolUse` hook reading live state at call time, exactly as
 * `claude-concierge-guard.ts` does and for the reason its header gives: the hook
 * resolves before permissions are consulted at all. A pass returns no decision
 * rather than `allow`, so it stacks with the AFK hook and the Concierge's
 * instead of replacing either.
 *
 * Deliberately *not* an entry in `disallowedTools`: the SDK settles that list
 * when `query()` opens and a planning session has to become a writing one the
 * moment the user approves the plan, in the same process. A deny list fixed at
 * open would strand an approved session with no editor.
 *
 * It also *allows*, which the sibling guards never do, because plan mode holds
 * the control surface shut on its own. The CLI routes every MCP tool it cannot
 * read as read-only to `canUseTool` while the mode is `plan`, and a workspace
 * that wires none hands the call nowhere to go — so the whole surface came back
 * `Cannot call … while in plan mode`, `ensemblr_exit_plan_mode` included, which
 * left a planning session with no way out at all. Pre-approving them here
 * restores the posture `evaluatePlanModeTool` already takes on the Pi side:
 * control tools are gated by `planModeControlOpDenial` at the control server,
 * per op and per role, which is a finer answer than the CLI can give from a tool
 * name. What each workspace regains still differs, because that server is the
 * gate: a trusted one gets the naming and summary ops back as well, while a
 * `read-only` one keeps them blocked by its own mode and regains the reads, the
 * question, and the exit.
 *
 * The one other widening is the user's own: a tool they listed as read-only
 * under Settings → Providers is cleared on the same terms while planning, because
 * the CLI withholds an MCP tool it cannot read exactly as it withholds ours. That
 * list never names a tool a sibling guard refuses — `toTrustedToolSet` strips
 * every name a policy already answers for — so an allow here still cannot
 * overturn one of theirs, and `approval-required` is excluded by
 * `withholdsControlTools` — there the same routing ends at the user's own
 * approval card rather than at a refusal, and clearing the tool would spend the
 * gate that mode exists to provide.
 */
import type {
	HookCallbackMatcher,
	HookEvent,
	HookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';

import { isEnsemblrControlTool } from '../../shared/agent-control.ts';
import {
	isReadOnlyBashCommand,
	isVouchedByUser,
} from '../../shared/plan-mode.ts';

/**
 * Claude Code's file-mutating tools, under the capitalized names its SDK uses.
 * `NotebookEdit` and `MultiEdit` are listed for the same reason
 * `CONCIERGE_WRITE_TOOLS` lists them: one left off is a write with nothing in
 * front of it.
 */
const PLAN_MODE_WRITE_TOOLS: ReadonlySet<string> = new Set([
	'Edit',
	'MultiEdit',
	'NotebookEdit',
	'Write',
]);

/** Claude Code's shell tool, restricted to read-only commands while planning. */
const CLAUDE_SHELL_TOOL = 'Bash';

/**
 * What a refused call is told. It names both exits rather than the native one
 * alone, because the native one is not always there: the CLI publishes
 * `ExitPlanMode` only to a session running behind a per-tool approval callback,
 * which is `approval-required` and nothing else — so a trusted or read-only
 * workspace pointed at it gets `No such tool available`. The control op is the
 * one every planning root holds, and the plan bridge files a native submission
 * into the same service, so either lands in the same place.
 * @param cause - What about this call is not allowed while planning.
 * @returns The full reason to hand the model.
 */
function planModeReason(cause: string): string {
	return `Plan Mode is on — ${cause}. This is not a bug to work around: finish the plan and submit it with \`ensemblr_exit_plan_mode\`, or with your runtime's own \`ExitPlanMode\` where your tool list has one. If the user approves it, Plan Mode turns off and you can implement it.`;
}

/**
 * What Plan Mode decides about one Claude tool call. `pass` renders no hook
 * decision at all, leaving the call to the CLI's own permission flow and to
 * whatever the session's other guards make of it.
 */
export interface ClaudePlanModeVerdict {
	decision: 'allow' | 'deny' | 'pass';
	reason?: string;
}

/**
 * What a pre-approved control tool records as its reason, so the decision reads
 * as a policy rather than a blanket waiver if it ever surfaces in a log.
 */
const CONTROL_TOOL_ALLOWANCE =
	'Ensemblr control tools are gated at the control server, which answers for each op by the caller’s role and by whether the chat is planning.';

/** What a pre-approved user-trusted tool records as its reason, for the same log. */
const TRUSTED_TOOL_ALLOWANCE =
	'The user listed this tool as read-only under Settings → Providers → Read-only tools.';

/**
 * Classifies one Claude tool call against Plan Mode policy.
 *
 * Narrower than the Pi classifier's deny-by-default posture, on purpose. Claude
 * ships a large built-in tool set plus whatever the user's own settings and MCP
 * servers add, and the CLI's `plan` mode already answers for all of it; this
 * hook exists to hold the cases that mode has been observed to drop and the one
 * it holds too tightly, not to re-implement it. Anything else passes to the
 * mode's own judgement.
 *
 * `clearsWithheldTools` is required rather than defaulted because the classifier
 * cannot derive it: whether a withheld tool needs clearing is a fact about the
 * workspace's permission mode, which only the caller holds. Passing `false`
 * leaves the tool to the CLI, which is the right answer wherever the CLI can
 * raise an approval card for it.
 * @param clearsWithheldTools - Whether the CLI is withholding the tools it cannot read as read-only with nothing able to approve them.
 * @param toolInput - The tool call's raw input object.
 * @param toolName - The SDK tool name being called.
 * @param trustedTools - The tools the user vouches for as read-only on Claude Code.
 * @returns The decision, with a reason on everything but a pass.
 */
export function evaluateClaudePlanModeTool({
	clearsWithheldTools,
	toolInput,
	toolName,
	trustedTools,
}: {
	clearsWithheldTools: boolean;
	toolInput: Record<string, unknown>;
	toolName: string;
	trustedTools?: ReadonlySet<string>;
}): ClaudePlanModeVerdict {
	if (PLAN_MODE_WRITE_TOOLS.has(toolName)) {
		return {
			decision: 'deny',
			reason: planModeReason(
				`\`${toolName}\` cannot change files until the plan is approved`,
			),
		};
	}
	if (isEnsemblrControlTool(toolName)) {
		return clearsWithheldTools
			? { decision: 'allow', reason: CONTROL_TOOL_ALLOWANCE }
			: { decision: 'pass' };
	}
	if (toolName !== CLAUDE_SHELL_TOOL) {
		return clearsWithheldTools && isVouchedByUser(toolName, trustedTools)
			? { decision: 'allow', reason: TRUSTED_TOOL_ALLOWANCE }
			: { decision: 'pass' };
	}
	const command = toolInput.command;
	const verdict = isReadOnlyBashCommand(
		typeof command === 'string' ? command : '',
	);
	return verdict.ok
		? { decision: 'pass' }
		: {
				decision: 'deny',
				reason: planModeReason(
					`this \`Bash\` command is not read-only: ${verdict.reason}`,
				),
			};
}

/** Every `PreToolUse` matcher a session runs, keyed by hook event. */
type ClaudeHookMap = Partial<Record<HookEvent, HookCallbackMatcher[]>>;

/** Renders one hook decision in the shape the SDK reads it from. */
function decide(
	permissionDecision: 'allow' | 'deny',
	reason: string,
): HookJSONOutput {
	return {
		hookSpecificOutput: {
			hookEventName: 'PreToolUse',
			permissionDecision,
			permissionDecisionReason: reason,
		},
	};
}

/**
 * Builds the `PreToolUse` matcher that refuses a write while the chat is
 * planning, clears a control tool whenever the CLI is withholding one, and
 * clears a user-trusted tool the CLI is withholding while the chat plans.
 * @param isPlanning - Reads the session's live Plan Mode flag at tool-call time.
 * @param withholdsControlTools - Reads whether the CLI is withholding the control tools with nothing able to approve them.
 * @param readTrustedTools - Reads the user's read-only tool list for Claude Code at tool-call time.
 * @returns The matcher to register under `PreToolUse`.
 */
function createPlanModePreToolUseHook(
	isPlanning: () => boolean,
	withholdsControlTools: () => boolean,
	readTrustedTools: (() => ReadonlySet<string>) | undefined,
): HookCallbackMatcher {
	return {
		hooks: [
			async (input): Promise<HookJSONOutput> => {
				if (input.hook_event_name !== 'PreToolUse') {
					return {};
				}
				const clearsWithheldTools = withholdsControlTools();
				const clearsThisCall =
					clearsWithheldTools && isEnsemblrControlTool(input.tool_name);
				if (!isPlanning() && !clearsThisCall) {
					return {};
				}
				const verdict = evaluateClaudePlanModeTool({
					clearsWithheldTools,
					toolInput: (input.tool_input ?? {}) as Record<string, unknown>,
					toolName: input.tool_name,
					trustedTools: readTrustedTools?.(),
				});
				return verdict.decision === 'pass'
					? {}
					: decide(verdict.decision, verdict.reason ?? '');
			},
		],
	};
}

/**
 * Adds the Plan Mode guard to whatever hooks a session already runs behind.
 *
 * Composed rather than chosen between, for the reason `withAfkHooks` composes:
 * a session can be planning, unattended and a Concierge at once, and a deny from
 * any of them stands. This is the only one that also pre-approves, and what it
 * pre-approves is disjoint from what the other two refuse — the AFK hook names
 * Claude's native `AskUserQuestion`, which no user trust can name, and the
 * Concierge's clears every control tool and every user-trusted tool already —
 * so the last decision written cannot overturn one of theirs.
 * The two readers are not the same question, which is why the caller answers the
 * second one: the refusals follow the chat's own Plan Mode flag, while the
 * clearance follows the workspace's permission mode as well —
 * `withholdsControlTools` in `claude-permission-bridge.ts` owns that answer and
 * says why. The default keeps the two together for a caller that has no opinion,
 * which is the right answer for every workspace but `read-only`.
 * @param base - Hooks the session's other surfaces registered, if any.
 * @param isPlanning - Reads the session's live Plan Mode flag at tool-call time.
 * @param withholdsControlTools - Reads whether the CLI is withholding the control tools with nothing able to approve them; defaults to the Plan Mode flag.
 * @param readTrustedTools - Reads the user's read-only tool list for Claude Code; absent, no user-trusted tool is cleared.
 * @returns The combined hook map to hand the SDK.
 */
export function withPlanModeHooks(
	base: ClaudeHookMap | undefined,
	isPlanning: () => boolean,
	withholdsControlTools: () => boolean = isPlanning,
	readTrustedTools?: () => ReadonlySet<string>,
): ClaudeHookMap {
	return {
		...base,
		PreToolUse: [
			...(base?.PreToolUse ?? []),
			createPlanModePreToolUseHook(
				isPlanning,
				withholdsControlTools,
				readTrustedTools,
			),
		],
	};
}

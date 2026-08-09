import type {
	OnboardingCheckId,
	OnboardingCheckModel,
} from '@/renderer/types/onboarding';
import type {
	SetupCheckId,
	SetupCheckSnapshot,
	SetupDiagnosticsSnapshot,
} from '@/shared/ipc/contracts/setup';
import {
	AGENT_RUNTIME_CHECK_GROUPS,
	isPassingSetupStatus,
} from '@/shared/setup-checks';

/**
 * The card the wizard draws, and every check that has to pass for it to read as
 * ready — in card order within their steps. An agent runtime is more than its
 * executable, so its card is backed by the whole runtime group from
 * `AGENT_RUNTIME_CHECK_GROUPS`; the rest stand for themselves. Anything the
 * diagnostics snapshot carries beyond these belongs to Settings → Diagnostics.
 */
const WIZARD_CARDS: readonly {
	checkIds: readonly SetupCheckId[];
	id: OnboardingCheckId;
}[] = [
	{ checkIds: AGENT_RUNTIME_CHECK_GROUPS.pi, id: 'pi-executable' },
	{ checkIds: AGENT_RUNTIME_CHECK_GROUPS.claude, id: 'claude-executable' },
	{ checkIds: ['gh-cli'], id: 'gh-cli' },
	{ checkIds: ['gh-auth'], id: 'gh-auth' },
	{ checkIds: ['linear-oauth'], id: 'linear-oauth' },
];

/**
 * Projects the shipped diagnostics snapshot onto the wizard's card models.
 *
 * `detailMessage` rides along so the card renders the detail in the app language
 * the same way `SetupDiagnosticsPanel` does. Titles are translated here instead
 * of from the check id, because the wizard shows one or two cards and wants
 * shorter names than a settings list of fifteen.
 * @param snapshot - The diagnostics snapshot, or undefined before it arrives.
 * @param titles - Translated card title per check.
 * @returns The card models, or null while the first probe is still in flight.
 */
export function toOnboardingChecks(
	snapshot: SetupDiagnosticsSnapshot | undefined,
	titles: Record<OnboardingCheckId, string>,
): OnboardingCheckModel[] | null {
	if (!snapshot) {
		return null;
	}

	return WIZARD_CARDS.flatMap((card) => {
		const groupChecks = card.checkIds.flatMap((id) =>
			snapshot.checks.filter((candidate) => candidate.id === id),
		);
		const head = groupChecks.at(0);

		return head?.id === card.id
			? [toCardModel(head, groupChecks, card.id, titles[card.id])]
			: [];
	});
}

/**
 * Renders one card from its whole check group, so a runtime whose executable
 * resolved but whose handshake failed reads as the blocked runtime it is rather
 * than as ready. The first non-passing check speaks for the group: it names the
 * real problem and carries the actions that fix it.
 * @param head - The check the card is named for.
 * @param groupChecks - Every check the card's readiness depends on.
 * @param id - The wizard-facing check id, already narrowed.
 * @param title - Translated card title.
 * @returns The card model.
 */
function toCardModel(
	head: SetupCheckSnapshot,
	groupChecks: readonly SetupCheckSnapshot[],
	id: OnboardingCheckId,
	title: string,
): OnboardingCheckModel {
	const blocker =
		groupChecks.find((check) => !isPassingSetupStatus(check.status)) ?? head;

	return {
		detail: blocker.detail,
		...(blocker.detailMessage ? { detailMessage: blocker.detailMessage } : {}),
		id,
		remediations: blocker.remediationActions.map((action) => ({ ...action })),
		status: blocker.status,
		title,
	};
}

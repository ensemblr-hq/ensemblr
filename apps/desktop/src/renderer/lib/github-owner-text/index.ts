import type { TFunction } from 'i18next';

import type {
	GithubOwnerRestriction,
	GithubOwnerRestrictionCode,
} from '@/shared/ipc/contracts/quick-start';

/**
 * Why an owner cannot receive a repository, as a badge rather than a sentence.
 * A `Record` over the union rather than a `switch`, so a restriction added in
 * main is a missing-key compile error here instead of English on a translated
 * surface. The phrases stay short on purpose: they sit beside a login inside a
 * dropdown row, which grows to fit its widest item.
 */
const OWNER_RESTRICTION_TEXT: Record<
	GithubOwnerRestrictionCode,
	(t: TFunction) => string
> = {
	'owner-access-restricted': (t) =>
		t('common:quick-start.owner-restriction.access', 'No access'),
	'owner-create-restricted': (t) =>
		t('common:quick-start.owner-restriction.create', 'Owners only'),
};

/**
 * Labels an unpickable GitHub owner in the app's language, falling back to
 * main's English wording for a code this table does not carry.
 * @param t - Translator from the calling component.
 * @param restriction - The restriction main reported, or null when there is none.
 * @returns The badge to show, or null when the owner is pickable.
 */
export function ownerRestrictionText(
	t: TFunction,
	restriction: GithubOwnerRestriction | null,
): string | null {
	if (!restriction) {
		return null;
	}
	const authored = OWNER_RESTRICTION_TEXT[restriction.code];
	return authored ? authored(t) : restriction.message;
}

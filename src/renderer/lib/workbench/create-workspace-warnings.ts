import { toast } from 'sonner';

import { failureDetail, failureText } from '@/renderer/lib/failure-text';
import { i18n } from '@/renderer/lib/i18n';
import type { CreateWorkspaceResult } from '@/shared/ipc/contracts/workspace';

/**
 * Warns about a workspace that was created, but not the way the repository's
 * settings asked for — a configured base that no longer resolves, say.
 *
 * Creation succeeded, so this cannot ride the error toast every caller already
 * shows; and every caller has to make the call, not just the sidebar, because
 * the flow most likely to hit it is the clone dialog seeding its first
 * workspace right after main persisted the branch the user picked. Staying
 * silent there would leave the setting looking like the app ignored it.
 * @param result - A successful create-workspace result.
 */
export function reportCreateWorkspaceWarnings(
	result: CreateWorkspaceResult,
): void {
	for (const diagnostic of result.diagnostics) {
		if (diagnostic.severity !== 'warning') {
			continue;
		}
		const title = failureText(i18n.t, diagnostic);
		if (title) {
			toast.warning(title, {
				description: failureDetail(i18n.t, diagnostic) ?? undefined,
			});
		}
	}
}

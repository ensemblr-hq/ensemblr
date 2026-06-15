import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CheckIcon, ClipboardCheckIcon } from 'lucide-react';
import { useState } from 'react';

import {
	ensembleQueryKeys,
	setupDiagnosticsQuery,
} from '@/renderer/api/ensemble';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { SetupDiagnosticsPanel } from '@/renderer/components/setup-diagnostics';
import { Button } from '@/renderer/components/ui/button';
import { sanitizeDiagnosticsBundle } from '@/renderer/lib/diagnostics-bundle';

export const Route = createFileRoute('/_workbench/settings/diagnostics')({
	component: DiagnosticsRoute,
});

/**
 * Settings → Diagnostics. Renders the full setup gate so the user can resolve
 * blocked checks without leaving the workbench, plus a "Copy diagnostics
 * bundle" action that sanitizes secrets before placing JSON on the clipboard.
 */
function DiagnosticsRoute() {
	const queryClient = useQueryClient();
	const {
		data: snapshot,
		error: queryError,
		isFetching: queryFetching,
	} = useQuery(setupDiagnosticsQuery);
	const [copied, setCopied] = useState(false);

	const onRetry = async () => {
		await queryClient.refetchQueries({
			queryKey: ensembleQueryKeys.setupDiagnostics(),
		});
	};

	const onCopyBundle = async () => {
		if (!snapshot) return;
		try {
			await navigator.clipboard.writeText(
				JSON.stringify(sanitizeDiagnosticsBundle(snapshot), null, 2),
			);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1800);
		} catch {
			setCopied(false);
		}
	};

	return (
		<SettingsSection
			action={
				<Button
					disabled={!snapshot}
					onClick={onCopyBundle}
					size='sm'
					variant='outline'
				>
					{copied ? (
						<CheckIcon aria-hidden='true' className='size-4' />
					) : (
						<ClipboardCheckIcon aria-hidden='true' className='size-4' />
					)}
					{copied ? 'Copied' : 'Copy diagnostics bundle'}
				</Button>
			}
			description='Setup gate checks for Pi, git, GitHub, Linear, and the Ensemble runtime. The diagnostics bundle redacts secrets, account ids, and full paths before going to the clipboard.'
			title='Diagnostics'
		>
			<SetupDiagnosticsPanel
				error={queryError instanceof Error ? queryError.message : null}
				isRetrying={queryFetching}
				onRetry={onRetry}
				snapshot={snapshot ?? null}
			/>
		</SettingsSection>
	);
}

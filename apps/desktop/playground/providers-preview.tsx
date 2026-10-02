import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { AgentProvidersSection } from '@/renderer/components/settings/agent-providers/agent-providers-section';

import {
	isFixtureProviderSignedIn,
	setFixtureProviderSignedIn,
} from './agent-provider-fixtures.ts';
import {
	ControlGroup,
	SceneControls,
	SceneSection,
	SceneToggle,
} from './scene-chrome.tsx';

/**
 * Settings → Providers without Electron. Both tabs come out of the same
 * component, so the scene's only job is to feed the bridge two different
 * readiness snapshots and let the page render them side by side.
 */
export function ProvidersScene() {
	const queryClient = useQueryClient();
	const [signedIn, setSignedIn] = useState(isFixtureProviderSignedIn());

	const applySignedIn = (next: boolean) => {
		setFixtureProviderSignedIn(next);
		setSignedIn(next);
		void queryClient.invalidateQueries();
	};

	return (
		<SceneSection
			label='Settings · Providers'
			note='One tab panel driven by (descriptor, readiness). Pi reports no account and a failed RPC smoke test; Claude Code reports an account and a warning check.'
		>
			<SceneControls>
				<ControlGroup label='claude auth'>
					<SceneToggle
						isActive={signedIn}
						label='signed in'
						onClick={() => applySignedIn(true)}
					/>
					<SceneToggle
						isActive={!signedIn}
						label='signed out'
						onClick={() => applySignedIn(false)}
					/>
				</ControlGroup>
			</SceneControls>
			<div className='rounded-md border border-border bg-background'>
				<AgentProvidersSection />
			</div>
		</SceneSection>
	);
}

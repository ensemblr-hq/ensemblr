import { createFileRoute } from '@tanstack/react-router';

import { AgentProvidersSection } from '@/renderer/components/settings/agent-providers/agent-providers-section';

/** Route for the Providers settings section; renders the Pi and Claude Code runtime tabs. */
export const Route = createFileRoute('/_workbench/settings/providers')({
	component: ProvidersSettings,
});

/** Providers settings panel: one tabbed surface over every first-class agent runtime. */
function ProvidersSettings() {
	return <AgentProvidersSection />;
}

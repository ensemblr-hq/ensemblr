import type { WorkbenchHealth } from '@/renderer/types/workbench-shell';

export const healthTone: Record<
	WorkbenchHealth['state'],
	'muted' | 'ok' | 'warning'
> = {
	online: 'ok',
	pending: 'muted',
	unavailable: 'warning',
};

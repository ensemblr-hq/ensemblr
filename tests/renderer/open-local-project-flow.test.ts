import { toast } from 'sonner';
import { beforeEach, expect, test, vi } from 'vitest';
import { i18n } from '../../src/renderer/lib/i18n';
import type { RegisterLocalRepositoryResult } from '../../src/shared/ipc/contracts/repository';

const selectLocalRepository = vi.hoisted(() => vi.fn());
const registerLocalRepository = vi.hoisted(() => vi.fn());
const seedFirstWorkspace = vi.hoisted(() => vi.fn());

vi.mock('../../src/renderer/api/ensemblr-queries.ts', () => ({
	isEnsemblrApiAvailable: () => true,
	registerLocalRepository,
	selectLocalRepository,
}));
vi.mock('../../src/renderer/lib/workbench/seed-first-workspace.ts', () => ({
	seedFirstWorkspace,
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { openLocalProjectFlow } from '../../src/renderer/lib/workbench/open-local-project-flow';

beforeEach(() => {
	vi.clearAllMocks();
	selectLocalRepository.mockReset();
	registerLocalRepository.mockReset();
	seedFirstWorkspace.mockReset();
	void i18n.changeLanguage('en');
});

const registration: RegisterLocalRepositoryResult = {
	diagnostics: [],
	registered: true,
	repository: {
		createdAt: '2026-06-07T00:00:00.000Z',
		defaultBranch: 'main',
		id: 'repository-id',
		metadata: {},
		name: 'external-project',
		path: '/Users/example/external-project',
		remoteUrl: null,
		slug: 'external-project',
		updatedAt: '2026-06-07T00:00:00.000Z',
	},
	settingsSources: [],
};

test('returns quietly when the picker is canceled', async () => {
	selectLocalRepository.mockResolvedValue({ canceled: true });
	const setLocalProjectOpen = vi.fn();

	await openLocalProjectFlow({
		navigate: vi.fn(),
		setLastWorkspaceSelection: vi.fn(),
		setLocalProjectOpen,
	});

	expect(toast.error).not.toHaveBeenCalled();
	expect(setLocalProjectOpen).toHaveBeenLastCalledWith(false);
});

test('shows picker errors and cleans up progress state', async () => {
	selectLocalRepository.mockResolvedValue({
		canceled: false,
		error: 'Picker failed',
	});
	const setLocalProjectOpen = vi.fn();

	await openLocalProjectFlow({
		navigate: vi.fn(),
		setLastWorkspaceSelection: vi.fn(),
		setLocalProjectOpen,
	});

	expect(toast.error).toHaveBeenCalledWith('Picker failed');
	expect(setLocalProjectOpen).toHaveBeenLastCalledWith(false);
});

test('localizes known registration diagnostics and falls back for unknown codes', async () => {
	selectLocalRepository.mockResolvedValue({
		canceled: false,
		path: '/project',
	});
	registerLocalRepository.mockResolvedValue({
		...registration,
		registered: false,
		repository: null,
		diagnostics: [
			{
				code: 'repository-permission-denied',
				message: 'Permission denied for /project',
				severity: 'error',
			},
		],
	});
	const setLocalProjectOpen = vi.fn();

	await i18n.changeLanguage('ru');
	await openLocalProjectFlow({
		navigate: vi.fn(),
		setLastWorkspaceSelection: vi.fn(),
		setLocalProjectOpen,
	});
	expect(toast.error).toHaveBeenCalledWith(
		'Нет прав доступа к этому репозиторию.',
	);

	vi.clearAllMocks();
	await i18n.changeLanguage('el');
	await openLocalProjectFlow({
		navigate: vi.fn(),
		setLastWorkspaceSelection: vi.fn(),
		setLocalProjectOpen,
	});
	expect(toast.error).toHaveBeenCalledWith(
		'Δεν υπάρχει άδεια για αυτό το αποθετήριο.',
	);

	registerLocalRepository.mockResolvedValue({
		...registration,
		registered: false,
		repository: null,
		diagnostics: [
			{
				code: 'unrecognized-diagnostic',
				message: 'Raw diagnostic',
				severity: 'error',
			},
		],
	});
	await openLocalProjectFlow({
		navigate: vi.fn(),
		setLastWorkspaceSelection: vi.fn(),
		setLocalProjectOpen,
	});
	expect(toast.error).toHaveBeenCalledWith('Raw diagnostic');
});

test('registers the selected local folder in place before seeding its workspace', async () => {
	selectLocalRepository.mockResolvedValue({
		canceled: false,
		path: '/Users/example/external-project',
	});
	registerLocalRepository.mockResolvedValue(registration);
	seedFirstWorkspace.mockResolvedValue({ status: 'success' });
	const setLocalProjectOpen = vi.fn();

	await openLocalProjectFlow({
		navigate: vi.fn(),
		setLastWorkspaceSelection: vi.fn(),
		setLocalProjectOpen,
	});

	expect(registerLocalRepository).toHaveBeenCalledWith({
		path: '/Users/example/external-project',
	});
	expect(seedFirstWorkspace).toHaveBeenCalledWith(
		expect.objectContaining({ repositoryId: 'repository-id' }),
	);
	expect(setLocalProjectOpen).toHaveBeenNthCalledWith(1, true);
	expect(setLocalProjectOpen).toHaveBeenLastCalledWith(false);
});

test('shows seed failures without hiding their message', async () => {
	selectLocalRepository.mockResolvedValue({
		canceled: false,
		path: '/project',
	});
	registerLocalRepository.mockResolvedValue(registration);
	seedFirstWorkspace.mockResolvedValue({
		status: 'error',
		error: 'Seed failed',
	});
	const setLocalProjectOpen = vi.fn();

	await openLocalProjectFlow({
		navigate: vi.fn(),
		setLastWorkspaceSelection: vi.fn(),
		setLocalProjectOpen,
	});

	expect(toast.error).toHaveBeenCalledWith('Seed failed');
	expect(setLocalProjectOpen).toHaveBeenLastCalledWith(false);
});

test('shows thrown errors and cleans up progress state', async () => {
	selectLocalRepository.mockRejectedValue(new Error('Unexpected failure'));
	const setLocalProjectOpen = vi.fn();

	await openLocalProjectFlow({
		navigate: vi.fn(),
		setLastWorkspaceSelection: vi.fn(),
		setLocalProjectOpen,
	});

	expect(toast.error).toHaveBeenCalledWith('Unexpected failure');
	expect(setLocalProjectOpen).toHaveBeenLastCalledWith(false);
});

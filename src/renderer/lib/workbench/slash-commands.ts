import type { SlashCommandDescriptor } from '@/renderer/types/workbench';
import type { PiSlashCommandSource } from '@/shared/ipc/contracts/pi-session';

/** Source marker used for static fallback commands from Pi's TUI catalog. */
const BUILTIN_SLASH_COMMAND_SOURCE = 'builtin' satisfies PiSlashCommandSource;

/**
 * Pi's built-in slash commands. Vendored from
 * `@earendil-works/pi-coding-agent@0.79.0` `BUILTIN_SLASH_COMMANDS`
 * (dist/core/slash-commands.js). These commands are TUI-oriented and are only
 * used when SDK-backed project/user command discovery fails.
 */
export const SLASH_COMMANDS: readonly SlashCommandDescriptor[] = [
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: false,
		command: 'settings',
		description: 'Open settings menu',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: false,
		command: 'model',
		description: 'Select model (opens selector UI)',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: false,
		command: 'scoped-models',
		description: 'Enable/disable models for Ctrl+P cycling',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: false,
		command: 'export',
		description: 'Export session (HTML default, or specify path: .html/.jsonl)',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: false,
		command: 'import',
		description: 'Import and resume a session from a JSONL file',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: true,
		command: 'share',
		description: 'Share session as a secret GitHub gist',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: true,
		command: 'copy',
		description: 'Copy last agent message to clipboard',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: false,
		command: 'name',
		description: 'Set session display name',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: true,
		command: 'session',
		description: 'Show session info and stats',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: true,
		command: 'changelog',
		description: 'Show changelog entries',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: true,
		command: 'hotkeys',
		description: 'Show all keyboard shortcuts',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: false,
		command: 'fork',
		description: 'Create a new fork from a previous user message',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: true,
		command: 'clone',
		description: 'Duplicate the current session at the current position',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: false,
		command: 'tree',
		description: 'Navigate session tree (switch branches)',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: true,
		command: 'trust',
		description: 'Save project trust decision for future sessions',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: false,
		command: 'login',
		description: 'Configure provider authentication',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: false,
		command: 'logout',
		description: 'Remove provider authentication',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: true,
		command: 'new',
		description: 'Start a new session',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: true,
		command: 'compact',
		description: 'Manually compact the session context',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: false,
		command: 'resume',
		description: 'Resume a different session',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: true,
		command: 'reload',
		description: 'Reload keybindings, extensions, skills, prompts, and themes',
	},
	{
		source: BUILTIN_SLASH_COMMAND_SOURCE,
		autoSubmit: true,
		command: 'quit',
		description: 'Quit pi',
	},
];

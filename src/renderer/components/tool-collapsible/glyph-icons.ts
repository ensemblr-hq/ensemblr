import {
	BicepsFlexedIcon,
	BotIcon,
	BrainIcon,
	CircleXIcon,
	ClipboardListIcon,
	FileDiffIcon,
	FilePenIcon,
	FilePlusIcon,
	FileTextIcon,
	FolderTreeIcon,
	KanbanIcon,
	ListIcon,
	type LucideIcon,
	MessageCircleQuestionIcon,
	MessageSquareTextIcon,
	PanelsTopLeftIcon,
	PuzzleIcon,
	SearchIcon,
	StethoscopeIcon,
	TerminalIcon,
	WrenchIcon,
} from 'lucide-react';
import type { ToolGlyph } from '@/renderer/types/tool-presentation';

/**
 * The single icon each glyph key paints, shared by the tool row and the turn
 * summary strip so one tool always reads as the same mark wherever it appears.
 */
export const GLYPH_ICONS: Record<ToolGlyph, LucideIcon> = {
	'biceps-flexed': BicepsFlexedIcon,
	bot: BotIcon,
	brain: BrainIcon,
	'circle-x': CircleXIcon,
	'clipboard-list': ClipboardListIcon,
	'file-diff': FileDiffIcon,
	'file-pen': FilePenIcon,
	'file-plus': FilePlusIcon,
	'file-text': FileTextIcon,
	'folder-tree': FolderTreeIcon,
	kanban: KanbanIcon,
	list: ListIcon,
	'message-circle-question': MessageCircleQuestionIcon,
	'message-square-text': MessageSquareTextIcon,
	'panels-top-left': PanelsTopLeftIcon,
	puzzle: PuzzleIcon,
	search: SearchIcon,
	stethoscope: StethoscopeIcon,
	terminal: TerminalIcon,
	wrench: WrenchIcon,
};

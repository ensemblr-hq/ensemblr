import {
	BicepsFlexedIcon,
	BrainIcon,
	CircleXIcon,
	FilePenIcon,
	FilePlusIcon,
	FileTextIcon,
	FolderTreeIcon,
	type LucideIcon,
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
	brain: BrainIcon,
	'circle-x': CircleXIcon,
	'file-pen': FilePenIcon,
	'file-plus': FilePlusIcon,
	'file-text': FileTextIcon,
	'folder-tree': FolderTreeIcon,
	puzzle: PuzzleIcon,
	search: SearchIcon,
	stethoscope: StethoscopeIcon,
	terminal: TerminalIcon,
	wrench: WrenchIcon,
};

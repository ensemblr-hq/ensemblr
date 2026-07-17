import { createFileRoute } from '@tanstack/react-router';
import { useAtom } from 'jotai';

import { CodeBlock } from '@/renderer/components/code-block';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Input } from '@/renderer/components/ui/input';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import { Switch } from '@/renderer/components/ui/switch';
import {
	accessibleColorsAtom,
	codeLigaturesAtom,
	codeThemeAtom,
	coloredSidebarDiffsAtom,
	markdownStyleAtom,
	monoFontAtom,
	terminalFontAtom,
	terminalFontSizeAtom,
	themeAtom,
} from '@/renderer/state/preferences';
import { DEFAULT_APP_SETTINGS } from '@/shared/config/app-settings';

/** Route for the Appearance settings section; renders the appearance-settings panel. */
export const Route = createFileRoute('/_workbench/settings/appearance')({
	component: AppearanceSettings,
});

const DEFAULTS = DEFAULT_APP_SETTINGS.appearance;

const CODE_SAMPLE = `// Fetch user data
async function getUser(id: number): Promise<User> {
  const response = await fetch(\`/api/users/\${id}\`);
  const data = await response.json();
  return { name: data.name, active: true };
}`;

const MONO_PREVIEW = `// Preview
const greeting = 'Hello, World!';
function sum(a, b) { return a + b; }`;

/** Appearance settings panel for theme, code and markdown styling, and terminal font choices. */
function AppearanceSettings() {
	const [theme, setTheme] = useAtom(themeAtom);
	const [coloredDiffs, setColoredDiffs] = useAtom(coloredSidebarDiffsAtom);
	const [accessibleColors, setAccessibleColors] = useAtom(accessibleColorsAtom);
	const [codeTheme, setCodeTheme] = useAtom(codeThemeAtom);
	const [monoFont, setMonoFont] = useAtom(monoFontAtom);
	const [ligatures, setLigatures] = useAtom(codeLigaturesAtom);
	const [markdownStyle, setMarkdownStyle] = useAtom(markdownStyleAtom);
	const [terminalFont, setTerminalFont] = useAtom(terminalFontAtom);
	const [terminalSize, setTerminalSize] = useAtom(terminalFontSizeAtom);

	return (
		<SettingsSection title='Appearance'>
			<SettingRow
				control={
					<Select
						onValueChange={(v) => setTheme(v as typeof theme)}
						value={theme}
					>
						<SelectTrigger className='w-32' size='sm'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='system'>System</SelectItem>
							<SelectItem value='light'>Light</SelectItem>
							<SelectItem value='dark'>Dark</SelectItem>
						</SelectContent>
					</Select>
				}
				description='Toggle with ⌘⌥T.'
				label='Theme'
				modified={theme !== DEFAULTS.theme}
			/>

			<SettingRow
				control={
					<Switch checked={coloredDiffs} onCheckedChange={setColoredDiffs} />
				}
				description='Always show line change colors in the sidebar, even for unselected workspaces.'
				label='Colored sidebar diffs'
				modified={coloredDiffs !== DEFAULTS.coloredSidebarDiffs}
			/>

			<SettingRow
				control={
					<Select
						onValueChange={(v) =>
							setAccessibleColors(v as typeof accessibleColors)
						}
						value={accessibleColors}
					>
						<SelectTrigger className='w-40' size='sm'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='default'>Default</SelectItem>
							<SelectItem value='protanopia'>Protanopia</SelectItem>
							<SelectItem value='deuteranopia'>Deuteranopia</SelectItem>
							<SelectItem value='tritanopia'>Tritanopia</SelectItem>
						</SelectContent>
					</Select>
				}
				description='Theme optimized for color vision differences.'
				label='Accessible colors'
				modified={accessibleColors !== DEFAULTS.accessibleColors}
			/>

			<SettingRow
				control={
					<Select
						onValueChange={(v) => setCodeTheme(v as typeof codeTheme)}
						value={codeTheme}
					>
						<SelectTrigger className='w-44' size='sm'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='catppuccin-mocha'>Catppuccin Mocha</SelectItem>
							<SelectItem value='catppuccin-latte'>Catppuccin Latte</SelectItem>
							<SelectItem value='github-dark'>GitHub Dark</SelectItem>
							<SelectItem value='github-light'>GitHub Light</SelectItem>
							<SelectItem value='one-dark-pro'>One Dark Pro</SelectItem>
							<SelectItem value='solarized-dark'>Solarized Dark</SelectItem>
						</SelectContent>
					</Select>
				}
				description='Syntax highlighting for code blocks and editors.'
				label='Code theme'
				modified={codeTheme !== DEFAULTS.codeTheme}
				stack
			>
				<CodeBlock className='mt-3' code={CODE_SAMPLE} language='typescript' />
			</SettingRow>

			<SettingRow
				control={
					<Input
						aria-label='Mono font name'
						className='h-8 w-56'
						onChange={(e) => setMonoFont(e.target.value)}
						placeholder='JetBrainsMono Nerd Font Mono'
						value={monoFont}
					/>
				}
				description='Font used for code and diffs. The bundled Nerd Font is the default; custom fonts must be installed on your system.'
				label='Mono font'
				modified={monoFont !== DEFAULTS.monoFont}
				stack
			>
				<pre className='mt-3 overflow-x-auto rounded-md bg-code px-4 py-3 text-code-foreground text-xs leading-relaxed ring-1 ring-code-border'>
					<code style={{ fontFamily: `"${monoFont}", var(--font-mono)` }}>
						{MONO_PREVIEW}
					</code>
				</pre>
			</SettingRow>

			<SettingRow
				control={<Switch checked={ligatures} onCheckedChange={setLigatures} />}
				description='Use font ligatures in file editors and diffs.'
				label='Code ligatures'
				modified={ligatures !== DEFAULTS.codeLigatures}
			/>

			<SettingRow
				control={
					<Select
						onValueChange={(v) => setMarkdownStyle(v as typeof markdownStyle)}
						value={markdownStyle}
					>
						<SelectTrigger className='w-32' size='sm'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='default'>Default</SelectItem>
							<SelectItem value='compact'>Compact</SelectItem>
							<SelectItem value='prose'>Prose</SelectItem>
						</SelectContent>
					</Select>
				}
				description='Rendering style for markdown files.'
				label='Markdown style'
				modified={markdownStyle !== DEFAULTS.markdownStyle}
			/>

			<SettingRow
				control={
					<Input
						aria-label='Terminal font name'
						className='h-8 w-56'
						onChange={(e) => setTerminalFont(e.target.value)}
						placeholder='JetBrainsMono Nerd Font Mono'
						value={terminalFont}
					/>
				}
				description='The bundled Nerd Font is the default; enter another font name exactly as installed to override it.'
				label='Terminal font'
				modified={terminalFont !== DEFAULTS.terminalFont}
			/>

			<SettingRow
				control={
					<span className='text-muted-foreground text-xs tabular-nums'>
						{terminalSize}px
					</span>
				}
				description='Adjust the size of text in the integrated terminal.'
				label='Terminal font size'
				modified={terminalSize !== DEFAULTS.terminalFontSize}
				stack
			>
				<input
					aria-label='Terminal font size'
					className='mt-2 w-full accent-accent'
					max={24}
					min={8}
					onChange={(e) => setTerminalSize(Number(e.target.value))}
					step={1}
					type='range'
					value={terminalSize}
				/>
				<pre
					className='mt-3 overflow-x-auto rounded-md bg-terminal px-4 py-3 text-terminal-foreground leading-relaxed ring-1 ring-terminal-border'
					style={{
						fontFamily: `"${terminalFont}", var(--font-mono)`,
						fontSize: `${terminalSize}px`,
					}}
				>
					<code>
						~/project main v3.72{'\n'}$ npm test ✓{'\n'}↳ ► All tests passed!
					</code>
				</pre>
			</SettingRow>
		</SettingsSection>
	);
}

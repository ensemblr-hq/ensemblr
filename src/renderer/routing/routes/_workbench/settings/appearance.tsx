import { createFileRoute } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { CodeBlock } from '@/renderer/components/code-block';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { TerminalScrollbackRow } from '@/renderer/components/settings/terminal-scrollback-row';
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
	CODE_THEME_FAMILIES,
	codeLigaturesAtom,
	codeThemeAtom,
	codeThemeFamilyId,
	markdownStyleAtom,
	monoFontAtom,
	terminalFontAtom,
	terminalFontSizeAtom,
	themeAtom,
} from '@/renderer/state/preferences';
import { DEFAULT_APP_SETTINGS } from '@/shared/config';

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

// i18next-instrument-ignore -- source-code specimen for the font preview
const MONO_PREVIEW = `// Preview
const greeting = 'Hello, World!';
function sum(a, b) { return a + b; }`;

/** Appearance settings panel for theme, code and markdown styling, and terminal font choices. */
function AppearanceSettings() {
	const { t } = useTranslation();
	const [theme, setTheme] = useAtom(themeAtom);
	const [accessibleColors, setAccessibleColors] = useAtom(accessibleColorsAtom);
	const [codeTheme, setCodeTheme] = useAtom(codeThemeAtom);
	const [monoFont, setMonoFont] = useAtom(monoFontAtom);
	const [ligatures, setLigatures] = useAtom(codeLigaturesAtom);
	const [markdownStyle, setMarkdownStyle] = useAtom(markdownStyleAtom);
	const [terminalFont, setTerminalFont] = useAtom(terminalFontAtom);
	const [terminalSize, setTerminalSize] = useAtom(terminalFontSizeAtom);

	return (
		<SettingsSection
			description={t(
				'settings:appearance.description',
				'Theme, syntax highlighting, the fonts used for code, diffs, and the integrated terminal, and how much scrollback each terminal pane holds.',
			)}
			title={t('settings:appearance.title', 'Appearance')}
		>
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
							<SelectItem value='system'>
								{t('settings:appearance.theme.system', 'System')}
							</SelectItem>
							<SelectItem value='light'>
								{t('settings:appearance.theme.light', 'Light')}
							</SelectItem>
							<SelectItem value='dark'>
								{t('settings:appearance.theme.dark', 'Dark')}
							</SelectItem>
						</SelectContent>
					</Select>
				}
				description={t(
					'settings:appearance.theme.description',
					'Toggle with ⌘⌥T.',
				)}
				label={t('settings:appearance.theme.label', 'Theme')}
				modified={theme !== DEFAULTS.theme}
				onReset={() => setTheme(DEFAULTS.theme)}
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
							<SelectItem value='default'>
								{t('settings:appearance.accessible-colors.default', 'Default')}
							</SelectItem>
							<SelectItem value='protanopia'>
								{t(
									'settings:appearance.accessible-colors.protanopia',
									'Protanopia',
								)}
							</SelectItem>
							<SelectItem value='deuteranopia'>
								{t(
									'settings:appearance.accessible-colors.deuteranopia',
									'Deuteranopia',
								)}
							</SelectItem>
							<SelectItem value='tritanopia'>
								{t(
									'settings:appearance.accessible-colors.tritanopia',
									'Tritanopia',
								)}
							</SelectItem>
						</SelectContent>
					</Select>
				}
				description={t(
					'settings:appearance.accessible-colors.description',
					'Theme optimized for color vision differences.',
				)}
				label={t(
					'settings:appearance.accessible-colors.label',
					'Accessible colors',
				)}
				modified={accessibleColors !== DEFAULTS.accessibleColors}
				onReset={() => setAccessibleColors(DEFAULTS.accessibleColors)}
			/>

			<SettingRow
				control={
					<Select
						onValueChange={(v) => setCodeTheme(v as typeof codeTheme)}
						value={codeThemeFamilyId(codeTheme)}
					>
						<SelectTrigger className='w-44' size='sm'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{CODE_THEME_FAMILIES.map((family) => (
								<SelectItem key={family.dark} value={family.dark}>
									{family.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				}
				description={t(
					'settings:appearance.code-theme.description',
					'Syntax highlighting for code blocks and editors. Each theme follows the app theme, using its light cut in light mode and its dark cut in dark mode.',
				)}
				label={t('settings:appearance.code-theme.label', 'Code theme')}
				modified={codeTheme !== DEFAULTS.codeTheme}
				onReset={() => setCodeTheme(DEFAULTS.codeTheme)}
				stack
			>
				<CodeBlock code={CODE_SAMPLE} language='typescript' />
			</SettingRow>

			<SettingRow
				control={
					<Input
						aria-label={t(
							'settings:appearance.mono-font.aria-label',
							'Mono font name',
						)}
						className='h-7 w-56'
						onChange={(e) => setMonoFont(e.target.value)}
						placeholder='JetBrainsMono Nerd Font Mono'
						value={monoFont}
					/>
				}
				description={t(
					'settings:appearance.mono-font.description',
					'Font used for code and diffs. The bundled Nerd Font is the default; custom fonts must be installed on your system.',
				)}
				label={t('settings:appearance.mono-font.label', 'Mono font')}
				modified={monoFont !== DEFAULTS.monoFont}
				onReset={() => setMonoFont(DEFAULTS.monoFont)}
				stack
			>
				<pre className='overflow-x-auto rounded-xl bg-code px-4 py-3 text-code-foreground text-xs leading-relaxed ring-1 ring-code-border'>
					<code style={{ fontFamily: `"${monoFont}", var(--font-mono)` }}>
						{MONO_PREVIEW}
					</code>
				</pre>
			</SettingRow>

			<SettingRow
				control={<Switch checked={ligatures} onCheckedChange={setLigatures} />}
				description={t(
					'settings:appearance.code-ligatures.description',
					'Use font ligatures in file editors and diffs.',
				)}
				label={t('settings:appearance.code-ligatures.label', 'Code ligatures')}
				modified={ligatures !== DEFAULTS.codeLigatures}
				onReset={() => setLigatures(DEFAULTS.codeLigatures)}
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
							<SelectItem value='default'>
								{t('settings:appearance.markdown-style.default', 'Default')}
							</SelectItem>
							<SelectItem value='compact'>
								{t('settings:appearance.markdown-style.compact', 'Compact')}
							</SelectItem>
							<SelectItem value='prose'>
								{t('settings:appearance.markdown-style.prose', 'Prose')}
							</SelectItem>
						</SelectContent>
					</Select>
				}
				description={t(
					'settings:appearance.markdown-style.description',
					'Rendering style for markdown files.',
				)}
				label={t('settings:appearance.markdown-style.label', 'Markdown style')}
				modified={markdownStyle !== DEFAULTS.markdownStyle}
				onReset={() => setMarkdownStyle(DEFAULTS.markdownStyle)}
			/>

			<SettingRow
				control={
					<Input
						aria-label={t(
							'settings:appearance.terminal-font.aria-label',
							'Terminal font name',
						)}
						className='h-7 w-56'
						onChange={(e) => setTerminalFont(e.target.value)}
						placeholder='JetBrainsMono Nerd Font Mono'
						value={terminalFont}
					/>
				}
				description={t(
					'settings:appearance.terminal-font.description',
					'The bundled Nerd Font is the default; enter another font name exactly as installed to override it.',
				)}
				label={t('settings:appearance.terminal-font.label', 'Terminal font')}
				modified={terminalFont !== DEFAULTS.terminalFont}
				onReset={() => setTerminalFont(DEFAULTS.terminalFont)}
			/>

			<SettingRow
				control={
					<span className='text-muted-foreground text-xs tabular-nums'>
						{t('common:units.px', '{{value}}px', { value: terminalSize })}
					</span>
				}
				description={t(
					'settings:appearance.terminal-font-size.description',
					'Adjust the size of text in the integrated terminal.',
				)}
				label={t(
					'settings:appearance.terminal-font-size.label',
					'Terminal font size',
				)}
				modified={terminalSize !== DEFAULTS.terminalFontSize}
				onReset={() => setTerminalSize(DEFAULTS.terminalFontSize)}
				stack
			>
				<div className='space-y-3'>
					<input
						aria-label={t(
							'settings:appearance.terminal-font-size.label',
							'Terminal font size',
						)}
						className='w-full accent-accent'
						max={24}
						min={8}
						onChange={(e) => setTerminalSize(Number(e.target.value))}
						step={1}
						type='range'
						value={terminalSize}
					/>
					<pre
						className='overflow-x-auto rounded-xl bg-terminal px-4 py-3 text-terminal-foreground leading-relaxed ring-1 ring-terminal-border'
						style={{
							fontFamily: `"${terminalFont}", var(--font-mono)`,
							fontSize: `${terminalSize}px`,
						}}
					>
						<code>
							~/project main v3.72{'\n'}$ npm test ✓{'\n'}↳ ► All tests passed!
						</code>
					</pre>
				</div>
			</SettingRow>

			<TerminalScrollbackRow />
		</SettingsSection>
	);
}

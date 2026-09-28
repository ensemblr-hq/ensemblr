import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createLinuxAppIconResolver } from '../../src/main/open-target/linux-app-icon';

const createdRoots: string[] = [];

// Unreal names, because the Flatpak export roots are always searched and a
// plausible name could resolve to an icon the machine running the suite has.
const ENTRY_ID = 'dev.ensemblr.ProbeApp';
const ICON_NAME = 'ensemblr-probe-icon';

const HICOLOR_INDEX = `[Icon Theme]
Name=Hicolor
Directories=16x16/apps,48x48/apps,scalable/apps,16x16/mimetypes

[16x16/apps]
Size=16
Context=Applications
Type=Threshold

[48x48/apps]
Size=48
Context=Applications
Type=Threshold

[scalable/apps]
Size=128
MinSize=64
MaxSize=256
Context=Applications
Type=Scalable

[16x16/mimetypes]
Size=16
Context=MimeTypes
Type=Threshold
`;

/** The throwaway host a test resolves icons against. */
interface FakeHost {
	configHome: string;
	env: Record<string, string>;
	homeDirectory: string;
	share: string;
}

/**
 * Builds a throwaway XDG tree and registers it for cleanup.
 * @param desktop - Value for `XDG_CURRENT_DESKTOP`.
 * @returns The host's directories and the environment pointing at them.
 */
async function createHost(desktop = 'KDE'): Promise<FakeHost> {
	const root = await mkdtemp(path.join(tmpdir(), 'ensemblr-linux-icon-'));
	createdRoots.push(root);
	const share = path.join(root, 'share');
	const configHome = path.join(root, 'config');
	const homeDirectory = path.join(root, 'home');
	await mkdir(configHome, { recursive: true });
	await writeHostFile(share, 'icons/hicolor/index.theme', HICOLOR_INDEX);
	return {
		configHome,
		env: {
			XDG_CONFIG_HOME: configHome,
			XDG_CURRENT_DESKTOP: desktop,
			XDG_DATA_DIRS: share,
			XDG_DATA_HOME: path.join(homeDirectory, '.local', 'share'),
		},
		homeDirectory,
		share,
	};
}

/**
 * Writes a file beneath a directory, creating its parents.
 * @param base - Directory the relative path is joined onto.
 * @param relativePath - Path of the file beneath `base`.
 * @param contents - File contents.
 * @returns The absolute path written.
 */
async function writeHostFile(
	base: string,
	relativePath: string,
	contents = '',
): Promise<string> {
	const filePath = path.join(base, relativePath);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, contents, 'utf8');
	return filePath;
}

/**
 * Installs the probe app's `.desktop` entry with the given `Icon=` value.
 * @param host - The host to install into.
 * @param icon - The entry's `Icon=` value.
 */
async function installDesktopEntry(
	host: FakeHost,
	icon: string,
): Promise<void> {
	await writeHostFile(
		host.share,
		`applications/${ENTRY_ID}.desktop`,
		`[Desktop Entry]\nType=Application\nIcon=${icon}\n\n[Desktop Action new]\nIcon=wrong-icon\n`,
	);
}

/**
 * Resolves the probe app's icon on a host.
 * @param host - The host to resolve against.
 * @returns The resolved icon path, or null.
 */
function resolveProbeIcon(host: FakeHost): string | null {
	return createLinuxAppIconResolver({
		env: host.env,
		homeDirectory: host.homeDirectory,
	})({ commands: [], entryIds: [ENTRY_ID] });
}

afterEach(async () => {
	await Promise.all(
		createdRoots.splice(0).map((root) => rm(root, { recursive: true })),
	);
});

describe('createLinuxAppIconResolver', () => {
	test("resolves the .desktop entry's Icon= through the hicolor theme", async () => {
		const host = await createHost();
		await installDesktopEntry(host, ICON_NAME);
		const icon = await writeHostFile(
			host.share,
			`icons/hicolor/48x48/apps/${ICON_NAME}.png`,
		);

		expect(resolveProbeIcon(host)).toBe(icon);
	});

	// Breeze and friends draw a monochrome glyph at 16 px and the coloured app
	// icon from 48 px up, so the smallest size is the wrong one to pick.
	test('prefers the directory whose size range covers the lookup size', async () => {
		const host = await createHost();
		await installDesktopEntry(host, ICON_NAME);
		await writeHostFile(
			host.share,
			`icons/hicolor/16x16/apps/${ICON_NAME}.png`,
		);
		const scalable = await writeHostFile(
			host.share,
			`icons/hicolor/scalable/apps/${ICON_NAME}.svg`,
			'<svg/>',
		);

		expect(resolveProbeIcon(host)).toBe(scalable);
	});

	test("never looks outside a directory's declared Applications context", async () => {
		const host = await createHost();
		await installDesktopEntry(host, ICON_NAME);
		await writeHostFile(
			host.share,
			`icons/hicolor/16x16/mimetypes/${ICON_NAME}.png`,
		);

		expect(resolveProbeIcon(host)).toBeNull();
	});

	// hicolor's index stops at 512 px, and some packages install nothing else.
	test('finds an icon in a sized directory the index does not declare', async () => {
		const host = await createHost();
		await installDesktopEntry(host, ICON_NAME);
		const icon = await writeHostFile(
			host.share,
			`icons/hicolor/1024x1024/apps/${ICON_NAME}.png`,
		);

		expect(resolveProbeIcon(host)).toBe(icon);
	});

	test('on Plasma, searches the kdeglobals theme and its parents before hicolor', async () => {
		const host = await createHost('KDE');
		await installDesktopEntry(host, ICON_NAME);
		await writeHostFile(
			host.configHome,
			'kdeglobals',
			'[Icons]\nTheme=probe-dark\n',
		);
		await writeHostFile(
			host.share,
			'icons/probe-dark/index.theme',
			'[Icon Theme]\nInherits=probe-light,hicolor\nDirectories=apps/48\n\n[apps/48]\nSize=48\nContext=Applications\nType=Scalable\nMinSize=48\nMaxSize=256\n',
		);
		await writeHostFile(
			host.share,
			'icons/probe-light/index.theme',
			'[Icon Theme]\nDirectories=apps/48\n\n[apps/48]\nSize=48\nContext=Applications\nType=Scalable\nMinSize=48\nMaxSize=256\n',
		);
		const inherited = await writeHostFile(
			host.share,
			`icons/probe-light/apps/48/${ICON_NAME}.svg`,
			'<svg/>',
		);
		await writeHostFile(
			host.share,
			`icons/hicolor/48x48/apps/${ICON_NAME}.png`,
		);

		expect(resolveProbeIcon(host)).toBe(inherited);
	});

	test("outside Plasma, reads the theme from GTK's settings.ini", async () => {
		const host = await createHost('GNOME');
		await installDesktopEntry(host, ICON_NAME);
		await writeHostFile(
			host.configHome,
			'kdeglobals',
			'[Icons]\nTheme=probe-kde\n',
		);
		await writeHostFile(
			host.configHome,
			'gtk-3.0/settings.ini',
			'[Settings]\ngtk-icon-theme-name=probe-gtk\n',
		);
		await writeHostFile(
			host.share,
			`icons/probe-kde/48x48/apps/${ICON_NAME}.png`,
		);
		const gtkIcon = await writeHostFile(
			host.share,
			`icons/probe-gtk/48x48/apps/${ICON_NAME}.png`,
		);

		expect(resolveProbeIcon(host)).toBe(gtkIcon);
	});

	test('takes an absolute Icon= path when it names a loadable file', async () => {
		const host = await createHost();
		const icon = await writeHostFile(host.share, 'pixmaps/probe.png');
		await installDesktopEntry(host, icon);

		expect(resolveProbeIcon(host)).toBe(icon);
	});

	test('refuses an absolute Icon= path in a format it cannot load', async () => {
		const host = await createHost();
		const icon = await writeHostFile(host.share, 'pixmaps/probe.xpm');
		await installDesktopEntry(host, icon);

		expect(resolveProbeIcon(host)).toBeNull();
	});

	test('refuses an icon name that climbs out of the theme directory', async () => {
		const host = await createHost();
		await writeHostFile(host.share, 'icons/hicolor/48x48/escape.png');
		await installDesktopEntry(host, '../escape');

		expect(resolveProbeIcon(host)).toBeNull();
	});

	test('falls back to the entry id as the icon name when no .desktop exists', async () => {
		const host = await createHost();
		const icon = await writeHostFile(
			host.share,
			`icons/hicolor/48x48/apps/${ENTRY_ID}.png`,
		);

		expect(resolveProbeIcon(host)).toBe(icon);
	});

	test('finds an unthemed icon in a pixmaps directory', async () => {
		const host = await createHost();
		await installDesktopEntry(host, ICON_NAME);
		const icon = await writeHostFile(host.share, `pixmaps/${ICON_NAME}.png`);

		expect(resolveProbeIcon(host)).toBe(icon);
	});
});

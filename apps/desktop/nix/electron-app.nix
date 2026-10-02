# Turns an unpacked Ensemblr package directory (the `Ensemblr` Electron binary
# beside its `resources/`) into a NixOS package. Every ELF file is patched
# against nixpkgs libraries, and the binary is wrapped with the GTK environment
# its file chooser needs. The release and master variants both end here.
#
# The library set mirrors `electronLibPath` in nixpkgs'
# pkgs/development/tools/electron/binary/generic.nix, which is what an upstream
# Electron binary needs on NixOS. Keep the two in step when Electron grows a
# dependency.
{
  lib,
  stdenv,
  autoPatchelfHook,
  copyDesktopItems,
  makeDesktopItem,
  makeWrapper,
  wrapGAppsHook3,
  alsa-lib,
  at-spi2-atk,
  cairo,
  cups,
  dbus,
  expat,
  gdk-pixbuf,
  glib,
  gtk3,
  gtk4,
  libdrm,
  libgbm,
  libGL,
  libnotify,
  libpulseaudio,
  libsecret,
  libx11,
  libxcb,
  libxcomposite,
  libxdamage,
  libxext,
  libxfixes,
  libxkbcommon,
  libxkbfile,
  libxrandr,
  libxshmfence,
  nspr,
  nss,
  pango,
  pciutils,
  pipewire,
  speechd-minimal,
  systemd,
  vulkan-loader,
}:
{
  pname,
  version,
  appDir,
  sourceProvenance,
  passthru ? { },
}:
let
  # The Linux launcher id, `APP_LINUX_APP_IDS.release` in
  # src/shared/build-channel.ts. The app claims it through
  # `app.setDesktopName`, so the desktop entry has to carry the same name for
  # the desktop to pair the window with its icon.
  launcherId = "ensemblr";

  # Loaded with dlopen by the Electron binary rather than linked, so
  # autoPatchelf cannot see them. libsecret backs `safeStorage`, which is where
  # Ensemblr keeps secrets on Linux.
  dlopenedLibs = [
    gtk3
    gtk4
    libGL
    libnotify
    libpulseaudio
    libsecret
    pciutils
    pipewire
    speechd-minimal
    systemd
    vulkan-loader
  ];
in
stdenv.mkDerivation {
  inherit pname version passthru;

  dontUnpack = true;
  dontConfigure = true;
  dontBuild = true;
  # Stripping upstream Electron binaries buys nothing and risks corrupting them.
  dontStrip = true;
  # The wrapper is made by hand below, so the hook does not wrap $out/lib too.
  dontWrapGApps = true;
  strictDeps = true;

  nativeBuildInputs = [
    autoPatchelfHook
    copyDesktopItems
    makeWrapper
    wrapGAppsHook3
  ];

  buildInputs = [
    (lib.getLib stdenv.cc.cc)
    alsa-lib
    at-spi2-atk
    cairo
    cups
    dbus
    expat
    gdk-pixbuf
    glib
    gtk3
    gtk4
    libdrm
    libgbm
    libGL
    libnotify
    libpulseaudio
    libsecret
    libx11
    libxcb
    libxcomposite
    libxdamage
    libxext
    libxfixes
    libxkbcommon
    libxkbfile
    libxrandr
    libxshmfence
    nspr
    nss
    pango
    pciutils
    pipewire
    speechd-minimal
    systemd
    vulkan-loader
  ];

  runtimeDependencies = map lib.getLib dlopenedLibs;

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib
    cp -r ${appDir} $out/lib/${launcherId}
    chmod -R u+w $out/lib/${launcherId}

    # The bundled loader cannot find the host's Vulkan drivers; nixpkgs' can.
    ln -sf ${lib.getLib vulkan-loader}/lib/libvulkan.so.1 $out/lib/${launcherId}/libvulkan.so.1

    for icon in $out/lib/${launcherId}/resources/icons/icon-*.png; do
      size=''${icon##*/icon-}
      size=''${size%.png}
      install -Dm644 "$icon" "$out/share/icons/hicolor/''${size}x''${size}/apps/${launcherId}.png"
    done

    runHook postInstall
  '';

  preFixup = ''
    makeWrapper "$out/lib/${launcherId}/Ensemblr" "$out/bin/${launcherId}" \
      "''${gappsWrapperArgs[@]}"
  '';

  desktopItems = [
    (makeDesktopItem {
      name = launcherId;
      desktopName = "Ensemblr";
      genericName = "Multi-agent coding workbench";
      comment = "Desktop workbench for isolated, multi-agent coding workflows";
      exec = "${launcherId} %U";
      icon = launcherId;
      categories = [ "Development" ];
      startupWMClass = launcherId;
    })
  ];

  meta = {
    description = "Desktop workbench for isolated, multi-agent coding workflows";
    homepage = "https://www.ensemblr.dev";
    license = lib.licenses.asl20;
    mainProgram = launcherId;
    platforms = [ "x86_64-linux" ];
    inherit sourceProvenance;
  };
}

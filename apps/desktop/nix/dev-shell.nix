# The one development environment for the whole repository: `nix develop`
# puts Node, Bun, and the native-module toolchain first on PATH, so every
# script — installs, the dev server, the test suites, the checks — runs against
# the same tools on every machine. The versions come from the manifests rather
# than being restated here: Node's major from `engines.node`, Electron's from the
# desktop app's `devDependencies`, and Bun from nixpkgs, which `packageManager`
# names exactly.
{ pkgs }:
let
  inherit (pkgs) lib stdenv;

  rootManifest = lib.importJSON ../../../package.json;
  desktopManifest = lib.importJSON ../package.json;

  nodeMajor = builtins.head (builtins.match ">=([0-9]+).*" rootManifest.engines.node);
  electronMajor = lib.versions.major (lib.removePrefix "^" desktopManifest.devDependencies.electron);

  nodejs =
    pkgs."nodejs_${nodeMajor}"
      or (throw "nixpkgs has no nodejs_${nodeMajor}; bump flake.lock to a nixpkgs that does");

  # npm's Electron is a generic-Linux binary that cannot find its libraries on
  # NixOS, and on any Linux it would run against the host glibc while node-pty
  # is compiled against Nix's. nixpkgs' build of the same major runs everywhere
  # and loads that binding; native modules are ABI-bound to the major alone.
  electron =
    pkgs."electron_${electronMajor}"
      or (throw "nixpkgs has no electron_${electronMajor}; bump flake.lock to a nixpkgs that does");

  # On macOS the compiler and SDK come from the Xcode Command Line Tools: Nix's
  # darwin stdenv exports its own SDKROOT and DEVELOPER_DIR, which `xcrun`
  # then follows to a toolchain without codesign or notarytool.
  mkShell = if stdenv.hostPlatform.isDarwin then pkgs.mkShellNoCC else pkgs.mkShell;
in
mkShell (
  {
    packages = [
      nodejs
      pkgs.bun
      pkgs.gnumake
      pkgs.python3
    ]
    # `make:linux` packs the AppImage with mksquashfs.
    ++ lib.optionals stdenv.hostPlatform.isLinux [ pkgs.squashfs-tools ];
  }
  // lib.optionalAttrs stdenv.hostPlatform.isLinux {
    ELECTRON_OVERRIDE_DIST_PATH = "${electron}/bin";

    # A host LD_LIBRARY_PATH points at libraries built against the host's
    # glibc. NixOS sets one for ALSA and PipeWire's JACK shim, and a library from
    # a newer glibc kills Electron at load with `GLIBC_2.43 not found`.
    shellHook = ''
      unset LD_LIBRARY_PATH
    '';
  }
)

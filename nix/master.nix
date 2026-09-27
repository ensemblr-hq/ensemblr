# The master variant: Ensemblr compiled from this flake's own commit and
# packaged by Electron Forge the way CI packages it, then patched like the
# release.
#
# The build sandbox has no network, so everything Forge would download comes
# from one fixed-output derivation, `deps`: node_modules as `bun install` lays
# them out, plus the Electron zip and headers bun.lock resolves to. Its hash
# lives in ./pins.json and goes stale whenever bun.lock changes; refresh it with
# `nix/update-pins.sh deps`.
{
  lib,
  stdenv,
  stdenvNoCC,
  bun,
  cacert,
  curl,
  fetchurl,
  jq,
  nodejs_24,
  python3,
  writableTmpDirAsHomeHook,
  electronApp,
  self,
  bunPin,
  depsHash,
}:
let
  pname = "ensemblr-master";

  packageVersion = (lib.importJSON ../package.json).version;
  baseVersion = builtins.head (lib.splitString "-" packageVersion);
  commitTime = self.lastModifiedDate;
  commitDate = lib.concatStringsSep "-" [
    (builtins.substring 0 4 commitTime)
    (builtins.substring 4 2 commitTime)
    (builtins.substring 6 2 commitTime)
  ];
  shortRev = self.shortRev or self.dirtyShortRev or "unknown";

  # What the About panel shows, shaped like the nightly's stamp so it names the
  # commit it was built from.
  appVersion = "${baseVersion}-master.${builtins.substring 0 8 commitTime}.g${shortRev}";
  version = "${baseVersion}-unstable-${commitDate}";

  # The Bun `packageManager` names, rather than whichever one the consumer's
  # nixpkgs carries: the deps hash is only reproducible against one Bun.
  pinnedBun = bun.overrideAttrs {
    inherit (bunPin) version;
    src = fetchurl {
      url = "https://github.com/oven-sh/bun/releases/download/bun-v${bunPin.version}/bun-linux-x64-baseline.zip";
      inherit (bunPin) hash;
    };
  };

  # A fixed-output path depends only on its name and hash, so a stale hash
  # would silently reuse the old node_modules. Naming it after the lockfile
  # forces a fetch, and with it a hash mismatch, whenever bun.lock moves.
  lockDigest = builtins.substring 0 16 (
    builtins.hashString "sha256" (builtins.readFile ../bun.lock + builtins.readFile ../bunfig.toml)
  );

  deps = stdenvNoCC.mkDerivation {
    name = "ensemblr-deps-${lockDigest}";

    src = lib.fileset.toSource {
      root = ../.;
      fileset = lib.fileset.unions [
        ../package.json
        ../bun.lock
        ../bunfig.toml
      ];
    };

    nativeBuildInputs = [
      cacert
      curl
      jq
      pinnedBun
      writableTmpDirAsHomeHook
    ];

    impureEnvVars = lib.fetchers.proxyImpureEnvVars;

    dontConfigure = true;

    buildPhase = ''
      runHook preBuild

      export BUN_INSTALL_CACHE_DIR=$(mktemp -d)
      bun install --frozen-lockfile --ignore-scripts --backend=copyfile \
        --os=linux --cpu=x64 --no-progress

      # The per-platform `claude` binaries the SDK ships: Forge never packages
      # them, and the user brings their own `claude` anyway.
      rm -rf node_modules/@anthropic-ai/claude-agent-sdk-*

      electronVersion=$(jq -r .version node_modules/electron/package.json)
      mkdir -p electron/headers
      curl --fail --location --retry 3 --silent --show-error \
        --output "electron/electron-v$electronVersion-linux-x64.zip" \
        "https://github.com/electron/electron/releases/download/v$electronVersion/electron-v$electronVersion-linux-x64.zip"
      curl --fail --location --retry 3 --silent --show-error \
        "https://artifacts.electronjs.org/headers/dist/v$electronVersion/node-v$electronVersion-headers.tar.gz" |
        tar -xz -C electron/headers
      echo "$electronVersion" > electron/version

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p $out
      cp -R node_modules electron $out/

      runHook postInstall
    '';

    # A fixed-output derivation may not refer to other store paths, and fixup
    # would write some in (patched shebangs, for one).
    dontFixup = true;

    outputHash = depsHash;
    outputHashMode = "recursive";
  };

  unwrapped = stdenv.mkDerivation {
    pname = "${pname}-unwrapped";
    inherit version;

    src = ../.;

    nativeBuildInputs = [
      jq
      nodejs_24
      python3
      writableTmpDirAsHomeHook
    ];

    env = {
      ENSEMBLR_ELECTRON_ZIP_DIR = "${deps}/electron";
      npm_config_nodedir = "${deps}/electron/headers/node_headers";
    };

    configurePhase = ''
      runHook preConfigure

      cp -R ${deps}/node_modules node_modules
      chmod -R u+w node_modules

      jq --tab --arg version ${lib.escapeShellArg appVersion} '.version = $version' \
        package.json > package.json.stamped
      mv package.json.stamped package.json

      runHook postConfigure
    '';

    buildPhase = ''
      runHook preBuild

      # Forge's system check shells out to a package manager and git, neither
      # of which the package step needs.
      touch "$HOME/.skip-forge-system-check"

      # node-pty is compiled here, against Electron's own headers, rather than
      # inside Forge's package step: that step would leave node-gyp's Makefiles
      # and object files in app.asar, and with them paths to the compiler and to
      # the deps derivation. The `.forge-meta` this writes makes Forge's rebuild
      # skip the module.
      node node_modules/@electron/rebuild/lib/cli.js \
        --version "$(cat ${deps}/electron/version)" --arch x64 \
        --module-dir . --only node-pty --force --build-from-source
      rm -rf node_modules/node-pty/node-addon-api
      find node_modules/node-pty/build -mindepth 1 -maxdepth 1 ! -name Release -exec rm -rf {} +
      find node_modules/node-pty/build/Release -mindepth 1 -maxdepth 1 \
        ! -name pty.node ! -name .forge-meta -exec rm -rf {} +

      node node_modules/@electron-forge/cli/dist/electron-forge.js package \
        --platform=linux --arch=x64

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      cp -r out/Ensemblr-linux-x64 $out

      runHook postInstall
    '';

    # The upstream Electron files are patched once, by `electronApp`.
    dontFixup = true;

    # Anything here would reach the installed closure through app.asar.
    disallowedReferences = [
      deps
      nodejs_24
      python3
    ];
  };
in
electronApp {
  inherit pname version;
  appDir = unwrapped;
  sourceProvenance = [
    lib.sourceTypes.fromSource
    lib.sourceTypes.binaryNativeCode
  ];
  passthru = {
    inherit deps unwrapped;
  };
}

# The release variant: the AppImage a GitHub release ships, unpacked and
# patched for NixOS rather than run inside an FHS sandbox.
#
# `appimageTools.wrapType2` would run it under bubblewrap, which sets
# no_new_privs, so `sudo` would fail in every terminal Ensemblr opens.
#
# The pin lives in ./pins.json; `nix/update-pins.sh release` moves it to the
# newest release.
{
  lib,
  appimageTools,
  fetchurl,
  electronApp,
  pin,
}:
let
  pname = "ensemblr";
  inherit (pin) version;

  src = fetchurl {
    url = "https://github.com/ensemblr-hq/ensemblr/releases/download/v${version}/${pin.asset}";
    inherit (pin) hash;
  };

  extracted = appimageTools.extract { inherit pname version src; };
in
electronApp {
  inherit pname version;
  # `@reforged/maker-appimage` keeps the packaged app in `usr/lib/<desktop id>`.
  appDir = "${extracted}/usr/lib/ensemblr";
  sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
}

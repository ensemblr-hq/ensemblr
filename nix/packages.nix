# Both variants of Ensemblr, built from the pins in ./pins.json. The flake's
# `packages` and its overlay both come through here, so they cannot drift.
{ pkgs, self }:
let
  pins = builtins.fromJSON (builtins.readFile ./pins.json);
  system = pkgs.stdenv.hostPlatform.system;
  electronApp = pkgs.callPackage ./electron-app.nix { };
in
{
  release = pkgs.callPackage ./release.nix {
    inherit electronApp;
    pin = pins.release;
  };

  master = pkgs.callPackage ./master.nix {
    inherit electronApp self;
    bunPin = pins.bun;
    depsHash = pins.deps.${system} or (throw "nix/pins.json has no deps hash for ${system}");
  };
}

{
  description = "Ensemblr, a desktop workbench for isolated, multi-agent coding workflows";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      # nixpkgs dropped x86_64-darwin in 26.11, so an Intel Mac has no dev shell.
      devSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forDevSystems = f: nixpkgs.lib.genAttrs devSystems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      # `nix develop` — Node, Bun, and the native-module toolchain every script
      # in the repository expects. See apps/desktop/nix/dev-shell.nix.
      devShells = forDevSystems (pkgs: {
        default = import ./apps/desktop/nix/dev-shell.nix { inherit pkgs; };
      });

      formatter = forDevSystems (pkgs: pkgs.nixfmt-tree);
    };
}

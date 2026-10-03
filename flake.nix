{
  description = "Ensemblr, a desktop workbench for isolated, multi-agent coding workflows";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      # The only Linux build Ensemblr ships is x86-64, and the master build
      # compiles node-pty against Electron's x64 headers.
      systems = [ "x86_64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      # Development reaches further than the shipped package. nixpkgs dropped
      # x86_64-darwin in 26.11, so an Intel Mac has no dev shell.
      devSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      # The desktop app owns its packaging; this flake stays at the repository
      # root because that is where `github:ensemblr-hq/ensemblr#…` resolves it.
      ensemblrVariants = pkgs: import ./apps/desktop/nix/packages.nix { inherit pkgs self; };
    in
    {
      # `release` is the AppImage a GitHub release ships; `master` is compiled
      # from this flake's own commit. Both install as `ensemblr` with the same
      # identity, so a system carries one or the other.
      packages = forAllSystems (
        pkgs:
        let
          variants = ensemblrVariants pkgs;
        in
        variants // { default = variants.release; }
      );

      overlays.default =
        final: _prev:
        let
          variants = ensemblrVariants final;
        in
        {
          ensemblr = variants.release;
          ensemblr-master = variants.master;
        };

      # `nix develop` — Node, Bun, and the native-module toolchain every script
      # in the repository expects. See apps/desktop/nix/dev-shell.nix.
      devShells = nixpkgs.lib.genAttrs devSystems (system: {
        default = import ./apps/desktop/nix/dev-shell.nix { pkgs = nixpkgs.legacyPackages.${system}; };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt-tree);
    };
}

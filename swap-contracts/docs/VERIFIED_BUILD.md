# Solve3 DEX verified build

Program: `HnosXNWPvKSFkY6xjUpCJ9nhbvTRhdfNTfWpgp3m4GK`

The mainnet executable deployed at slot `458181137` matches a build of this
repository's `solve` library using the committed `Cargo.lock` and Solana
verifiable-build image for CLI `4.1.0`. Its `solana-verify` executable hash is
`9786ac86815ad7ad3032c76fb6f67ef33c2f57c0304aced8bae421ccf922fe44`.

From the workspace root:

```sh
solana-verify build --library-name solve
solana-verify get-executable-hash target/deploy/solve.so
solana-verify verify-from-repo -u https://api.mainnet-beta.solana.com \
  --program-id HnosXNWPvKSFkY6xjUpCJ9nhbvTRhdfNTfWpgp3m4GK \
  https://github.com/solve3fi/contracts \
  --commit-hash <this-commit> \
  --library-name solve \
  --base-image solanafoundation/solana-verifiable-build@sha256:6468b89ae21d87b8eb002f894ac3f3442dbd8bcf5ea93414051e96e00d03b5ab
```

Run from the repository workspace root. With `solana-verify` 0.5.2, the root
must be the Docker mount so the container can read the workspace `Cargo.toml`
and `Cargo.lock`; the library name selects `programs/solve`.
The explicit image digest is also required by remote workers whose verifier
version does not yet map Solana CLI `4.1.0` to this image.

The verification PDA upload must be signed by the program upgrade authority,
`4j3VFftvWC4R2KxbF4R8bJKz2Mxk3m6a2RjkEu8ySVPs`. After uploading it,
submit the remote rebuild:

```sh
solana-verify remote submit-job \
  --program-id HnosXNWPvKSFkY6xjUpCJ9nhbvTRhdfNTfWpgp3m4GK \
  --uploader 4j3VFftvWC4R2KxbF4R8bJKz2Mxk3m6a2RjkEu8ySVPs
```

The deployed binary embeds an outdated `security.txt` source URL. Changing
that URL changes the executable and requires a new deployment and verification.

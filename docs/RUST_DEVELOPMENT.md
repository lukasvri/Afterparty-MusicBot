# Rust audio research on dev

This page describes an **experiment**, not a production Rust rewrite.

Afterparty's live audio engine remains TypeScript/Node.js with FFmpeg for decoding
and Opus encoding. The prototype in `experiments/rust-audio` mixes one 20 ms
frame of 48 kHz, stereo signed 16-bit PCM audio with volume and crossfade.
It deliberately uses synthetic data, no Discord connection, no credentials
and no shared production databases.

## Branches and checks

- `main` remains the default branch for TypeScript development, fixes and new
  application features through reviewed PRs.
- `dev` is the separate branch for isolated Rust testing, originally based on
  the latest `main`. It is not the staging branch for normal TypeScript work
  or a Rust compiler channel. Existing `nightly` and Rust branches are preserved.
- Focused `experiment/rust-*` branches target `dev` through PRs, where Rust checks run for
  changes in this experiment. CI does not start the bot or deploy artifacts.
- CI checks formatting, Clippy, locked tests and release builds on Linux and
  Windows with both the declared minimum Rust 1.85.0 and current stable.
- Any future adoption of Rust in `main` needs a separate owner decision,
  focused review and validation. There is no automatic promotion from `dev`
  or `nightly` to `main`.

The prototype was copied from `nightly` commit
`75f56a4617aae1914601d708e634a84147d8bc39`, including the rounding parity
fix and minimum-toolchain checks from `2c864e5e7e1116f5e493703ca10761f7e1533684`.
The Rust source and Cargo files are unchanged by the transfer. The workflow
targets `dev` instead of `nightly`; this does not merge the old branch history
into `main` or remove the original experiment.

## Running on a Linux development checkout

The Linux laptop hosts the production bot as well. Use a **separate checkout**,
not the active deployment directory. Never run the experiment with Core
credentials or the production data path.

```bash
git clone --branch dev https://github.com/lukasvri/Afterparty-MusicBot.git ~/Afterparty-Rust-Dev
cd ~/Afterparty-Rust-Dev
rustup toolchain install stable --profile minimal --component rustfmt --component clippy
cargo fmt --manifest-path experiments/rust-audio/Cargo.toml --all -- --check
cargo clippy --manifest-path experiments/rust-audio/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path experiments/rust-audio/Cargo.toml --locked
cargo build --manifest-path experiments/rust-audio/Cargo.toml --release --locked
cargo run --manifest-path experiments/rust-audio/Cargo.toml --release --locked -- --bench
```

Do not benchmark while production playback is active. Local benchmark results
measure **only synthetic PCM mixing**, not FFmpeg, providers, Discord latency,
network behaviour or complete end-to-end CPU consumption. Compare against a
matching TypeScript implementation on the same machine before evaluating a
native replacement. Follow `AGENTS.md` and production backup/rollback rules
for any future integration.

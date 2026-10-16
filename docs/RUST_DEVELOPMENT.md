# Rust audio research on nightly

This page describes an **experiment**, not a production Rust rewrite.

Afterparty's live audio engine remains TypeScript/Node.js with FFmpeg for decoding
and Opus encoding. The prototype in `experiments/rust-audio` mixes one 20 ms
frame of 48 kHz, stereo signed 16-bit PCM audio with volume and crossfade.
It deliberately uses synthetic data, no Discord connection, no credentials
and no shared production databases.

## Branches and checks

- `main` is the reviewed production code reference.
- `nightly` is the ongoing development integration branch, not a scheduled
  nightly release, deployment job or Rust compiler channel.
- Feature branches target `nightly` through PRs, where Rust checks run for
  changes in this experiment. CI does not start the bot or deploy artifacts.
- Promote tested and reviewed changes to `main` only as a separate approval
  and release step.

## Running on a Linux development checkout

The Linux laptop hosts the production bot as well. Use a **separate checkout**,
not the active deployment directory. Never run the experiment with Core
credentials or the production data path.

```bash
git clone --branch nightly https://github.com/lukasvri/Afterparty-MusicBot.git ~/Afterparty-Nightly
cd ~/Afterparty-Nightly
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

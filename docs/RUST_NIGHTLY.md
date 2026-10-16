# Rust audio nightly experiment

This is an isolated proof of concept, NOT a replacement for Afterparty Core.
The existing Node.js/TypeScript Discord bot, FFmpeg and SQLite data stay
unchanged. This experiment implements only mixing of 20 ms, 48 kHz stereo,
signed 16-bit PCM samples. It uses synthetic audio and cannot connect to
Discord, Core, live hosting, or production databases.

## GitHub Actions

The "Experimental Rust audio nightly" workflow in
.github/workflows/rust-audio-nightly.yml runs daily at 02:23 UTC on the latest
default branch. It also supports manual workflow_dispatch and pull request
validation. Linux and Windows jobs run formatting, Clippy, Rust unit tests,
release builds, and an offline synthetic benchmark. Workflow artifacts contain
the executable, benchmark output and source commit SHA and expire after 14 days.

Nightly means daily builds, NOT the unstable Rust nightly compiler. We use the
stable Rust toolchain (Rust 2024 edition) to simplify comparisons.

IMPORTANT: GitHub only runs scheduled workflows from the default branch.
The PR needs review, passing checks, and merge before its schedule activates.
GitHub may delay scheduled events or disable schedules on inactive public repos.
No build artifact is deployed automatically.

## Windows laptop

Install Git and Rust with rustup (using official sources), then confirm these
commands work from PowerShell: git --version, rustc --version, cargo --version.
Ensure Rust's rustfmt and clippy components are installed.

From your Afterparty checkout, run once manually:

    powershell -NoProfile -File .\scripts\rust-nightly.ps1

To register a local Windows Task Scheduler job for 03:30 LOCAL time each day:

    powershell -NoProfile -File .\scripts\rust-nightly.ps1 -InstallTask

Optionally use -At '04:00' to choose a different local hour. This registration
has to be executed on your laptop. The task runs as your own signed-in Windows
user, with no administrator privileges requested. It cannot run while the
laptop is powered off; missed jobs may start when the PC becomes available.
It does not wake the laptop from sleep.

Each local run clones fresh remote main into a temporary folder and never
resets, checks out, or modifies your existing working directory. It saves
build logs, the resulting executable, benchmark output and source commit at:

    %LOCALAPPDATA%\Afterparty\RustNightly\

Old builds are retained; review disk use and delete old generated runs when
you want. Install the task only AFTER this PR is merged to main. To stop it:

    Unregister-ScheduledTask -TaskName 'Afterparty Rust Nightly' -Confirm:$false

## Local experiment before merge

From a checkout of the experiment branch, you can build and test it manually:

    cargo fmt --manifest-path experiments/rust-audio/Cargo.toml --all -- --check
    cargo clippy --manifest-path experiments/rust-audio/Cargo.toml --all-targets --locked -- -D warnings
    cargo test --manifest-path experiments/rust-audio/Cargo.toml --locked
    cargo build --manifest-path experiments/rust-audio/Cargo.toml --release --locked

This is NOT an end-to-end audio benchmark. It omits media extraction, FFmpeg,
Discord packet pacing, network, voice reconnection and real playback. Comparing
performance to TypeScript would require a matching benchmark using identical
audio, machines and conditions. Do not claim better audio quality or capacity
from these results alone.

Keep all production credentials, private configs and data outside GitHub.
Follow AGENTS.md and the host backup and rollback rules before any future
integration with Core.

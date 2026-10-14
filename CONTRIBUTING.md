# Contributing

Thanks for considering a contribution. Start with an issue describing the concrete problem, steps to reproduce it and the expected behavior. Remove credentials, personal IDs and private log data.

## Development workflow

1. Fork the repository and create a branch.
2. Follow the [installation guide](docs/INSTALLATION.md) using your own test accounts and data.
3. Make a focused change and update the relevant documentation.
4. From the repository root, run:

   ```bash
   npm ci
   npm run project -- check
   npm run test:fullscreen
   node --test scripts/audio-preferences.test.mjs
   ```

5. Open a pull request describing the problem, resulting behavior and checks performed. State anything you could not verify.

Preserve per-server isolation, authorization, queue-version checks and the distinction between ordinary Discord music and public concerts. Audio changes must pass the real FFmpeg tests. Do not use production databases in tests.

New contributions are submitted under the project's MIT license. Keep third-party license notices intact. Never commit `.env`, `.dev.vars`, database files, backups or deployment-specific IDs.

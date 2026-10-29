# Matt Pocock skills in Codex Cloud

All 27 skills from Matt Pocock's plugin version 1.3.2 are
checked into `.agents/skills/`, including supporting resources and Codex UI
metadata. This is Codex's documented repository skill location. It requires no
user-level plugin installation or writes to a protected home directory.

Source: https://github.com/mattpocock/skills/tree/a496f5513d4a4cf889bc48e189e579f4b0bdf6aa

The upstream files are preserved with the MIT license alongside them.
Local patch: `wizard/template.sh` uses dotenv-compatible quoting and preserves
values containing apostrophes; values without a safe delimiter are rejected
before modifying the file. The accompanying synthetic round-trip test covers
Node dotenv loading and wizard readback.
To update, review a new upstream revision, replace the complete skill folders,
and validate their metadata, resources and project compatibility in a PR.

## Use

Start a new Codex Cloud task using a branch that includes these files. Ask it to
list discovered skills and confirm `wayfinder` and `to-tickets` paths under
`.agents/skills/` before claiming installation success. Existing tasks can retain
older repository state. Availability in the cloud web command picker still needs
to be verified there; local file checks alone do not establish that UI behavior.

Explicitly request `wayfinder` or `to-tickets` and follow this repository's
`docs/agents/issue-tracker.md`. User-invoked skills retain their upstream policy;
ordinary wording does not necessarily activate them automatically. Existing
project permissions, review and release rules continue to apply.

On a local client with the plugin already enabled, both installed and repository
copies can appear. Choose the repository copy for this project. These files
provide skill instructions; they do not install GitHub credentials, MCP servers,
new slash commands, or production services.

References:
- https://learn.chatgpt.com/docs/build-skills
- https://learn.chatgpt.com/docs/environments/cloud-environments

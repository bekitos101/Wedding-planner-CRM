# How to start with Claude Code

1. Copy everything in this folder into the root of your Git repo, keeping the hidden `.claude/` folder.
2. Install Node 20+, Docker, and Claude Code, then run `claude` in the repo root.
3. Kick off the scaffold:

   ```
   /build-phase 0
   ```

4. Continue phase by phase: `/build-phase 1`, `/build-phase 2`.
5. For phase 3, run the four tracks in parallel:

   ```
   Run tracks 3A, 3B, 3C and 3D in parallel using /build-phase, one backend and one frontend subagent per track.
   ```

6. Finish with `/build-phase 4`, then `5`, then `6`.

Useful commands:
- `@"reviewer (agent)" review my uncommitted changes` runs an extra review at any time.
- `/tasks` checks on subagents running in the background.

Before you start, look at "Decisions filling gaps in the spec" in CLAUDE.md. The defaults there
include what team members can read, the reminder timing, and the email retry policy. Change them
if your team decided differently.

`HOW-TO-START.md` itself can be deleted once you're set up.

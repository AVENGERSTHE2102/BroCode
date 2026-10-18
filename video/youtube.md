# YouTube title + description

## Title

Waypoint — Clarity Before Action | GraphHacks Demo

## Description

Waypoint is an action-first connected-data agent. FalkorDB is the graph store it actually
reasons on — not a visualization layer bolted on top of other storage. resolve_entity and
trace_entity are real, bounded GRAPH.QUERY calls; every answer is cited back to an
authorized tool result, and the agent abstains instead of guessing when evidence is thin.
Agents propose actions (like a GitHub patch as a draft PR); nothing executes without a
human approving it, and nothing is ever auto-merged.

Submitted for GraphHacks — primary track: Agents That Act on Connected Data, with
supporting tracks Company Brain and Agent Memory and Coordination.

Repo: https://github.com/AVENGERSTHE2102/BroCode

### What's real in this video vs. illustrated

Everything in the first ~75 seconds is a live screen recording against the running app
(2026-10-18): real Supabase-authenticated session, a real connected GitHub repository
(DeepMehta06/Archlens, synced the same day), a real local FalkorDB graph (160 entities,
191 relationships) via Docker, and a real agent run tracing resolve_entity → trace_entity
with its actual tool_call JSON and source URLs. Two live agent runs hit a Groq free-tier
rate limit mid-recording — that failure is also real, and is shown rather than cut around.

The graph-model diagram and the "agent proposes → human approves → draft PR" sequence
are illustrated, not live footage — they're labeled on screen. The GitHub draft-PR
execution path is implemented in the codebase but wasn't successfully exercised live
during this recording session; see the repo's IMPLEMENTATION_TRACKER.md for current status.

### Chapters

00:00 Cold open — scattered engineering context
00:06 Waypoint
00:11 Not a chatbot — a graph the agent can walk
00:19 Sign in — real workspace, real session
00:26 Connect a real GitHub repository
00:36 Ask — the agent traces the graph live
00:49 Every question becomes a saved investigation
01:01 The actual run trace (raw evidence, not a summary)
01:15 How it works — the graph model (illustrated)
01:27 Agents propose, a human approves (illustrated)
01:39 Numbers pulled from the terminal
01:49 Waypoint

### Disclosure

This project's code and this demo video were built with AI-assisted development
(Claude Code), per the hackathon's AI-assistant disclosure requirement (rule 11).

# FD-Substitute Reviewer Invocation Log

Companion to `docs/team-lead-fd-substitute.md`. Each substitute review appends one entry below (newest at bottom, chronological). Keeps the protocol's track record inspectable so repeated-override patterns surface and trigger-threshold tuning (per protocol §6.4) is data-driven rather than felt.

## Entry schema

```
### <YYYY-MM-DD> — Task #<id> @ <sha>
- Session: <session-id-prefix>
- Dev: <dev-name>
- FD at time of invocation: <fd-agent-name> (idle since <time>)
- Verdict: APPROVED (team-lead substitute) | REQUEST CHANGES (team-lead substitute)
- In-scope checks passed: <comma list, §4.1 dimensions>
- Deferred to FD post-hoc: <list or "none">
- Coverage gaps flagged: <list or "none beyond deferrals">
- FD post-hoc resolution: <pending | reviewed-and-concurred | reviewed-and-flagged:<details> | never-returned-this-session>
```

---

## Entries

### 2026-04-14 — Task #9 @ `3dcb949` + `540441e` (pre-codification ad-hoc invocation)
- Session: `70b36414`
- Dev: dev-3
- FD at time of invocation: frontend-designer (idle since early rework cycle)
- Verdict: APPROVED (team-lead substitute), with two structural issues flagged and fixed in follow-on commits
- In-scope checks passed: render structure, motion usage, structural a11y, IPC boundary, store boundary, test presence
- Deferred to FD post-hoc: typography hierarchy, spacing rhythm, motion feel values
- Coverage gaps flagged: none beyond deferrals; issues found in-scope were (a) ark-ui subpath import path, (b) copy-pasted demo page instead of prop-driven wrapper
- FD post-hoc resolution: pending (FD did not return by session end; substitute verdict stood)
- Note: this invocation predates the codified protocol — logged retroactively for completeness.

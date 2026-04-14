# FD-Substitute Reviewer Protocol

> **Purpose:** Define when and how the team-lead may act as a last-resort UI reviewer when the frontend-designer (FD) is unresponsive, without pretending the review has the full authority of a real FD review. This is a liveness patch for reviewer-gated flows, not a replacement for design review.

**Status:** Active. First invoked 2026-04-14 during the TimeSeriesVisualiser build, session `70b36414`, for Task #9 (UI components) after FD went idle during the dev-3 rework cycle.

**Related discipline:**
- `feedback_reviewer_gate.md` — tracker cannot flip to `completed` without an explicit reviewer ACK against a SHA
- `feedback_four_step_disk_read.md` — reviewer verdicts must cite `sha@path:line`, not working-tree state
- `feedback_compaction_replay_hazard.md` — post-compaction, re-establish ground truth before issuing routing

---

## 1. The Problem This Solves

In a reviewer-gated multi-agent pipeline, UI tasks are normally gated by the frontend-designer:

```
dev implements  →  dev commits  →  FD reviews (sha@path:line)  →  FD APPROVED  →  tracker: completed
```

When FD goes idle mid-pipeline (crash, rate-limit, teammate rotation, handoff gap), that chain stalls. Two failure modes appear if nothing intervenes:

1. **Silent drift:** team-lead or dev marks the tracker `completed` anyway "because the code looks fine," skipping the gate. This is the exact failure the reviewer-gate rule exists to prevent — it caused the Task #9 ark-ui-subpath + copy-pasted-demo bugs earlier in this session.
2. **Indefinite stall:** tracker stays `in_review` forever; downstream blocked tasks pile up; team grinds to a halt waiting for a teammate who is not coming back this session.

The FD-substitute protocol is the escape hatch: team-lead steps in as a **bounded, auditable** substitute reviewer — not as a pretend-FD, but as a distinct reviewer-of-last-resort with its own narrower scope and its own audit trail.

---

## 2. Trigger

The substitute protocol activates when **all** of the following are true:

1. A UI task is in `in_review` state (dev has committed and explicitly handed off to FD with a SHA).
2. FD has not responded to the handoff for **at least two team-lead polling cycles** (in practice: ~10–15 minutes of active team activity, **or** one full team-lead polling cycle after a direct-ping `SendMessage` to FD went unanswered — whichever fires first, so sparse-activity teams aren't forced to wait on wall-clock time and burst-activity teams don't fire prematurely).
3. The task is blocking at least one other active work item (a dev is idle waiting on it, or a downstream task cannot start).
4. Team-lead has logged at least one direct `SendMessage` to FD asking for status, with no reply.

**Not a trigger:** FD being slow on a non-blocking review. Latency alone is not enough. The substitute protocol is for **liveness**, not latency.

**Not a trigger:** team-lead disagreeing with a FD verdict FD already issued. That is an escalation path, not a substitution path — address it directly with FD.

---

## 3. Authority

Team-lead acting as FD-substitute has **strictly less authority** than FD:

| Aspect | FD review | Team-lead substitute review |
|---|---|---|
| Gate to flip tracker → `completed` | Yes, alone | Yes, alone, but subject to FD post-hoc override |
| Can block a merge/commit | Yes | Yes |
| Can demand re-work on design grounds | Yes | No — only on structural/a11y/correctness grounds (see §4) |
| Final on typography, spacing, design tokens | Yes | No — explicit carve-out, see §4 |
| Final on motion correctness | Yes | Yes (motion API usage is mechanical, not aesthetic) |
| Authoritative after session ends | Yes | Provisional — FD may re-open post-hoc |

The substitute is a **first-resort last-resort**: first-resort for un-blocking the tracker in this session, last-resort for design authority (FD reopens post-hoc if needed).

---

## 4. Scope — What Team-Lead Substitute Review Covers

### 4.1 In scope (team-lead may review and rule)

- **Render structure:** Component tree shape, prop wiring, state ownership, key hierarchy. Does `<AddLinePanel>` read from `useGraphStore` the way the plan says? Is the close button wired to `setRightPanel(null)`?
- **Motion usage:** `motion/react` API surface — correct `initial`/`animate`/`exit` tuples, correct `transition` prop, no mis-named imports. This is mechanical, not aesthetic.
- **a11y affordances (structural only):** `aria-label` on icon-only buttons, `type="button"` on non-submit buttons, keyboard-reachable interactive elements, form-semantic tags (`<button>` not `<div onClick>`).
- **IPC boundary correctness:** Renderer calls through `lib/ipc.ts` wrapper, not raw `window.tsv` at component level. No direct better-sqlite3 imports in renderer.
- **Store boundary correctness:** Component reads through the zustand selector it owns; no cross-store reach-arounds without a documented reason.
- **Test coverage presence:** If the atomic commit claims a test, the test file exists and runs. Substitute does NOT judge test quality beyond "does it assert the thing it claims to assert."

### 4.2 Out of scope — **defer to FD post-hoc**

- **Typography:** Font sizing, weight hierarchy, line-height choices, header scale.
- **Spacing rhythm:** Tailwind gap/padding values as an aesthetic system. (Team-lead may flag "no spacing at all" as a structural bug, but cannot rule on "`p-4` vs `p-3`.")
- **Color choices beyond mechanical correctness:** Team-lead can flag a hardcoded hex where a token should be used; cannot rule on palette harmony.
- **Design-system coherence:** "Does this feel like it belongs with the rest of the app?" That is FD's core contribution and not substitutable.
- **Motion feel / ergonomics:** Spring stiffness, damping, duration — the *choice* of values. Team-lead can verify the props exist and are numbers; cannot rule on whether the animation feels right.
- **Microcopy:** Button labels, empty-state messages, error messages — unless outright wrong or missing.

**Rule of thumb:** if a judgment requires *taste*, it is out of scope. If it requires *reading the code against a contract (plan, types, test)*, it is in scope.

---

## 5. Audit Trail Requirement

Every substitute review MUST produce a review artefact with the same SHA-citation discipline as a real FD review. The message team-lead sends to the dev and the tracker comment MUST:

1. **Name the reviewer role explicitly** — the verdict header is `APPROVED (team-lead substitute)` or `REQUEST CHANGES (team-lead substitute)`, never bare `APPROVED`. This prevents the substitute review from being read later as a real FD review.
2. **Cite the commit SHA being reviewed** — not working-tree state. `git show <sha>:<path>` content only. Uses the five-step commit-verified review procedure from `feedback_four_step_disk_read.md`.
3. **Quote `sha@path:line` for every substantive claim** — same as a real review. "Looks fine" without citations is not a substitute review, it is a skip.
4. **Enumerate explicit deferrals** — list anything out-of-scope (§4.2) that FD should look at post-hoc. Example: *"Deferring to FD post-hoc: typography hierarchy in the source picker (lines 118–140), spacing rhythm in the record list (lines 161–177)."*
5. **Flag coverage gaps** — if the substitute did not look at something a FD would have (e.g. visual regression of the animation), say so.

### 5.1 Audit message template

```
APPROVED (team-lead substitute) — <task-id> @ <sha>

Reviewed per substitute protocol because <fd-agent-name> has been idle since <time>.

IN-SCOPE CHECKS:
- Render structure:  <sha>@<path>:<lines> — <one-line verdict>
- Motion usage:      <sha>@<path>:<lines> — <one-line verdict>
- a11y structural:   <sha>@<path>:<lines> — <one-line verdict>
- IPC boundary:      <sha>@<path>:<lines> — <one-line verdict>
- Store boundary:    <sha>@<path>:<lines> — <one-line verdict>
- Test presence:     <sha>@<path>:<lines> — <one-line verdict>

DEFERRED TO FD POST-HOC:
- <dimension>: <path>:<lines> — <what FD should look at>
- ...

COVERAGE GAPS:
- <anything a FD would have checked that substitute did not> — or "none beyond deferrals above"
```

The tracker comment gets a link/pointer to this message, so FD (or a later session) can find it.

---

## 6. Un-Gate Criteria (FD Returns)

When FD becomes available again:

1. **Post-hoc review is always allowed, never required.** FD reads the substitute audit artefact, scans the deferred dimensions and coverage gaps. If FD is satisfied, no action needed.
2. **FD override is non-blocking to downstream work.** If FD finds an issue, they file a new task (or new commit request) rather than re-opening the original `completed` state. Downstream work that depended on the substitute-approved SHA is not retroactively invalidated — the SHA was real, the review was real, subsequent fixes land as normal follow-on commits.
3. **FD override DOES update the audit trail.** The original substitute-APPROVED message gets a pointer comment: *"FD post-hoc flagged X (see task #N); original approval stands for gating purposes, follow-on fix pending."* This preserves the history of what was known when.
4. **Repeated FD overrides of substitute reviews are a signal, not a crisis.** If FD keeps finding things the substitute missed, that means the scope (§4.1) is drawn too wide or the substitute is being used too aggressively. Adjust the trigger threshold (§2) upward, not the scope.

**What FD does NOT do:** retroactively downgrade a substitute-APPROVED SHA to REJECTED. The gate was passed; fixes go forward, not backward. This preserves the integrity of downstream tracker state.

---

## 7. Anti-Patterns (Things This Protocol Is NOT)

- **Not a way to skip FD when FD is available but slow.** Latency is not liveness.
- **Not a way to override FD.** If FD has given a verdict, the substitute protocol does not apply — escalate through normal channels.
- **Not invocable by devs.** Only team-lead may invoke the substitute role. A dev pinging "FD hasn't responded" is a *trigger-check input*, not a trigger by itself.
- **Not a silent role-swap.** Every substitute verdict is labelled as such. A bare `APPROVED` from team-lead on a UI task is a protocol violation — reviewers reading it later will assume it was FD.
- **Not recursive.** If team-lead is also unavailable, the gate stalls — that is the correct behaviour. Do not daisy-chain "planner-substitute-for-team-lead-substitute-for-FD."
- **Not a permanent assignment.** Each substitute review is scoped to one task + one SHA. The next UI task re-checks the trigger conditions from scratch.

---

## 8. Process Summary (Flow)

```
FD handoff with SHA
        │
        ▼
Is FD responsive within ~2 polling cycles?
        │
   ┌────┴────┐
   │         │
  yes        no (+ blocking + direct ping sent)
   │         │
   │         ▼
   │    Team-lead invokes substitute protocol
   │         │
   │         ▼
   │    Run 5-step commit-verified review (scope §4.1 only)
   │         │
   │         ▼
   │    Send audit message (§5.1 template) — verdict labelled "(team-lead substitute)"
   │         │
   │         ▼
   │    If APPROVED → tracker: completed; dev unblocked
   │    If REQUEST CHANGES → dev iterates; re-enters trigger check on next commit
   │         │
   ▼         ▼
Normal FD flow    Downstream work proceeds
                         │
                         ▼
                  When FD returns: post-hoc review (non-blocking, §6)
```

---

## 9. Provenance & Invocation Log

- **2026-04-14 (session `70b36414`):** First invocation (pre-codification). Task #9 (UI components, dev-3) re-reviewed by team-lead as substitute after FD went idle during rework cycle. Substitute flagged two structural issues (ark-ui subpath import path, demo-page-vs-prop-driven-wrapper). FD had not returned by session end; substitute verdict stood. This protocol was written immediately after, in the same session, to codify the ad-hoc procedure before it drifted.
- Follow-up: when FD returns, they should re-read the Task #9 substitute verdict against `3dcb949` + `540441e` and flag anything in the deferred/coverage-gap lists.

A running invocation log lives at `docs/team-lead-fd-substitute-log.md` (sibling file). Each substitute review appends an entry: date, session, task id, dev, SHA reviewed, verdict, any deferred items, and FD post-hoc resolution (when known). The log is inspectable for pattern analysis — if it grows fast or shows repeated FD overrides in one direction, that is a signal to tune the §2 trigger threshold upward per §6.4.

## 10. Operating-Environment Note: Shared Worktrees

This protocol assumes all teammates operate on a shared working tree (common in multi-agent sessions running from one repo checkout). That assumption creates cross-cutting hazards that touch the substitute protocol indirectly:

- **Scope-bleed commits:** a dev running `git add -A` or `git add .` can accidentally stage another teammate's in-flight files, committing them under the wrong author/message. If a substitute review receives a handoff SHA like "please review #X @ `<sha>`," the substitute MUST verify (via `git show --stat <sha>`) that the SHA's file list matches #X's plan scope — not some superset that captured a neighbour's work. If it doesn't match, the right move is to route attribution-honest messages to both affected devs (this is team-lead's judgment call, outside substitute scope) rather than approve the mislabelled SHA as-is.
- **Timing-stale reads:** the reviewer-gate discipline (`git show <sha>:path`) already handles this — never trust working-tree state, only committed state. The substitute protocol inherits that discipline unchanged.
- **`git add` hygiene:** when committing doc/config changes (including this protocol doc itself), prefer explicit `git add <path>` over `git add -A`. The shared-worktree hazard is real and recent.

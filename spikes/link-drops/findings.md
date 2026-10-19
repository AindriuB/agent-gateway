# Spike 155: what makes the module stop answering link pings?

## Question

In the 0.3.0 playtest the GM's link closed with 1006 five times. Task 108 showed each was the
gateway's own heartbeat terminate (Caddy durations are whole 15 s ticks), so the module had gone
silent for 30-45 s. Task 109 raised the tolerance to `MAX_MISSED_PONGS = 8` (terminate on the 9th
tick, about 135 s) and made any inbound frame count as liveness. This spike looks for the
module-side cause.

## What the module does

`module/src/link/client.ts` (the `case 'ping'` branch, about line 891) answers the gateway's
app-level `ping` from the ws `message` handler. It has no timer of its own. So a pong is late only
if the page's JS event loop is not running, or the page is not receiving the frame. A hidden tab
with throttled timers does not delay a `message` event.

## Probe

`spikes/link-drops/probe.mjs` runs a ws server that pings every 5 s, and a headless Chrome page
that answers from a `message` handler, as the module does. Chrome is driven over raw CDP; no
Foundry is needed. It reports the longest ping-to-pong time among answered pings and, separately, the age of the
oldest unanswered ping (the silence length), which is the figure that matters for `frozen` and
`discarded`, where nothing is answered.

    node spikes/link-drops/probe.mjs <baseline|hidden|frozen|blocked|discarded> <seconds>

Requires Google Chrome (override the path with `CHROME`) and the `ws` package already in the repo.
Runs were on macOS with a current Chrome.

Caveats: the server is a stand-in, not the real gateway, and there is no Caddy in the path (108
already ruled out Caddy). Headless Chrome has no real window occlusion, so `hidden` only covers a
backgrounded target, not OS-level occlusion or an idle laptop.

## Results by candidate

| Candidate                            | How tested                                                                                                         | Result                                                                                                                                                                                                                              | Explains 30-45 s    | Explains over 135 s                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------- |
| Tab hidden, timers throttled         | `hidden`, 40 s, a second target brought to front                                                                   | Every ping answered; worst ping-to-pong time was about 1 ms (no added delay)                                                                                                                                                        | No                  | No                                                                          |
| Main thread blocked by a long task   | `blocked`: a 40 s synchronous loop in the page                                                                     | One gap of 37.8 s, then all queued pings answered and the socket stayed open                                                                                                                                                        | Yes, exactly        | Only if the block outlasts 135 s                                            |
| Tab frozen (Page Lifecycle `freeze`) | `frozen`, 20 s via `Page.setWebLifecycleState`                                                                     | No pong during the freeze. The server's socket then closed with 1001 at resume. Pings were not answered after.                                                                                                                      | Yes                 | Yes, for as long as the freeze lasts. The gateway terminates at 135 s first |
| Tab discarded (Memory Saver)         | `discarded`: closes the target, so the socket drops                                                                | Immediate close, no silence. This is a stand-in only; whether Chrome discards a tab holding an open WebSocket was not verified here. A discarded page loses its socket and reconnects on reload, so it is a close, not a silent gap | Not as a silent gap | Not as a silent gap                                                         |
| Network or proxy                     | Not re-tested. Evidence from 108: Caddy v2.11.4 had no `/link` timeouts and no reload; closes landed on 15 s ticks | Ruled out by 108                                                                                                                                                                                                                    | No                  | No                                                                          |
| Gateway or stand-in artefact         | Reading `server.ts`                                                                                                | Heartbeat logic is as 108 described; since 109 any inbound frame resets `missed`                                                                                                                                                    | No                  | No                                                                          |

Notes on the two live candidates:

- A blocked main thread is the only candidate reproduced as a silent-then-recovering gap of the
  size seen in the playtest. It needs a long synchronous task in the GM's Foundry page (a scene
  load, compendium indexing, a heavy module). Foundry does that kind of work, but nothing in the
  evidence we hold shows a 30 s or longer task, so this is plausible, not proven.
- A frozen tab explains both windows, but the probe forces the freeze through CDP. Whether Chrome
  would freeze a page with an open WebSocket on its own was not verified here. Whether a real user's browser froze the GM tab
  is unknown; the playtest logs hold no `visibilityState` or lifecycle data.
- A machine sleep, or a network stall over 30 s, looks the same from the gateway's side as either
  of the above and cannot be separated from them with the data in hand.

Ranking by evidence: (1) main thread blocked or tab frozen/suspended by the OS or browser, which
the gateway cannot tell apart; (2) whole-machine stall; (3) throttling (excluded by the probe);
(4) proxy (excluded by 108).

## Does 109 cover it?

A pong gap of 30-45 s (the pre-109 window) is fully covered. A silence over 135 s is not, and
cannot be: if the page is frozen the connection is dead for practical purposes, and the module
reconnects when it next runs. In the probe only the stand-in server saw the 1001 close on resume;
the page side has no reconnect logic and logged nothing. The reconnect timing comes from
`backoffDelay` (`module/src/link/client.ts:159-165`), whose first retry is 1 s. Reconnect is
the correct recovery, and 108 showed the pending approval record survives it.

## Recommendation

Add a diagnostic first, then decide. Do not change heartbeat constants.

A probe forced a 10 s freeze and found `Date.now()` and `performance.now()` drifting apart by only
0.5 ms, so a clock-drift check cannot detect a freeze. After a freeze the server also sees a 1001
close and no queued ping is delivered, so a check inside the `ping` handler never runs in the
frozen case. The diagnostic therefore uses signals that survive a freeze.

Proposed (described, not made; both files belong to task 157), all in `module/src/link/client.ts`:

1. Register `document` `freeze` and `resume` listeners that log one console line each, with
   `document.visibilityState`. These fire only for a freeze (or resume from one), so they separate
   "tab frozen" from every other candidate.
2. In `onclose` (about line 705), log the time since the last inbound frame and since the last
   `ping`, plus the close code. A frozen page runs `onclose` only after it resumes, so a long
   time-since-last-ping with a `freeze` line just before it means a freeze; the same with no
   `freeze` line points at a sleep, a network stall or a long task.
3. In the `ping` handler, compare the time since the previous inbound frame with the expected
   interval, and when it exceeds 20 s log the gap, `document.visibilityState` and the
   `performance.now()` versus `Date.now()` drift. This check applies only to the long-task and
   sleep cases: a drift means the machine slept, no drift with no `freeze` line means a long task.
   Add a `PerformanceObserver` for `longtask` entries over 5 s and log those too.

Which signal separates which candidate: `freeze`/`resume` events mean a frozen tab; the `onclose`
timings with no `freeze` event rule out a freeze and leave sleep, network or a long task, which the
next two signals split;
clock drift means a machine sleep; a `longtask` entry, or a ping-handler gap with
`visibilityState: visible`, no drift and no `freeze`, means a long Foundry task. The cost is a few
listeners and one console line on a rare event; the risk is console noise, bounded by logging only
above the thresholds. Re-read the next playtest console. If a long task is the cause, the fix
belongs to whatever runs it, not to the link.

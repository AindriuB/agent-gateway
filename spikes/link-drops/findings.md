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
Foundry is needed. It reports the longest gap between a ping and the next pong.

    node spikes/link-drops/probe.mjs <baseline|hidden|frozen|blocked|discarded> <seconds>

Requires Google Chrome (override the path with `CHROME`) and the `ws` package already in the repo.
Runs were on macOS with a current Chrome.

Caveats: the server is a stand-in, not the real gateway, and there is no Caddy in the path (108
already ruled out Caddy). Headless Chrome has no real window occlusion, so `hidden` only covers a
backgrounded target, not OS-level occlusion or an idle laptop.

## Results by candidate

| Candidate                            | How tested                                                                                                         | Result                                                                                                                                                                                                                       | Explains 30-45 s    | Explains over 135 s                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------- |
| Tab hidden, timers throttled         | `hidden`, 40 s, a second target brought to front                                                                   | Every ping answered; worst gap equalled the 5 s ping interval (no added delay)                                                                                                                                               | No                  | No                                                                          |
| Main thread blocked by a long task   | `blocked`: a 40 s synchronous loop in the page                                                                     | One gap of 37.8 s, then all queued pings answered and the socket stayed open                                                                                                                                                 | Yes, exactly        | Only if the block outlasts 135 s                                            |
| Tab frozen (Page Lifecycle `freeze`) | `frozen`, 20 s via `Page.setWebLifecycleState`                                                                     | No pong during the freeze. The server's socket then closed with 1001 at resume. Pings were not answered after.                                                                                                               | Yes                 | Yes, for as long as the freeze lasts. The gateway terminates at 135 s first |
| Tab discarded (Memory Saver)         | `discarded`: closes the target, so the socket drops                                                                | Immediate close, no silence. A real discard of a socket-holding tab is not expected to happen in Chrome, which excludes pages with open connections from automatic freezing in most versions, but this was not verified here | Not as a silent gap | Not as a silent gap                                                         |
| Network or proxy                     | Not re-tested. Evidence from 108: Caddy v2.11.4 had no `/link` timeouts and no reload; closes landed on 15 s ticks | Ruled out by 108                                                                                                                                                                                                             | No                  | No                                                                          |
| Gateway or stand-in artefact         | Reading `server.ts`                                                                                                | Heartbeat logic is as 108 described; since 109 any inbound frame resets `missed`                                                                                                                                             | No                  | No                                                                          |

Notes on the two live candidates:

- A blocked main thread is the only candidate reproduced as a silent-then-recovering gap of the
  size seen in the playtest. It needs a long synchronous task in the GM's Foundry page (a scene
  load, compendium indexing, a heavy module). Foundry does that kind of work, but nothing in the
  evidence we hold shows a 30 s or longer task, so this is plausible, not proven.
- A frozen tab explains both windows, but Chrome normally refuses to freeze a page with an open
  WebSocket, and the probe forces it through CDP. Whether a real user's browser froze the GM tab
  is unknown; the playtest logs hold no `visibilityState` or lifecycle data.
- A machine sleep, or a network stall over 30 s, looks the same from the gateway's side as either
  of the above and cannot be separated from them with the data in hand.

Ranking by evidence: (1) main thread blocked or tab frozen/suspended by the OS or browser, which
the gateway cannot tell apart; (2) whole-machine stall; (3) throttling (excluded by the probe);
(4) proxy (excluded by 108).

## Does 109 cover it?

A pong gap of 30-45 s (the pre-109 window) is fully covered. A silence over 135 s is not, and
cannot be: if the page is frozen the connection is dead for practical purposes, and the module
reconnects in about 2 s when it next runs (it saw 1001/1006 on resume in the probe). Reconnect is
the correct recovery, and 108 showed the pending approval record survives it.

## Recommendation

Add a diagnostic first, then decide. Do not change heartbeat constants.

Proposed (described, not made; both files belong to task 157): in `module/src/link/client.ts`,
inside the existing `message` handler for `ping`, record the time since the previous inbound frame
and, when it exceeds 20 s, log one console line with the gap, `document.visibilityState`, and
`performance.now()` drift against `Date.now()` (a drift means the machine slept or the page was
frozen; none means a long task). Add a `PerformanceObserver` for `longtask` entries over 5 s and
log those too. The cost is one comparison per ping and one line on a rare event; the risk is
noise in the console, bounded by logging only above the threshold. Re-read the next playtest
console. If gaps over 30 s still appear with `visibilityState: visible` and no drift, the cause is
a long Foundry task and the fix belongs to whatever runs it, not to the link.

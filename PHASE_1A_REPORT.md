# Phase 1A — Forensic diagnosis of the prior USER_BUSY failure

Investigation only. No code changes.

## Pre-existing typecheck

`npx tsc --noEmit` exits 0 — clean baseline.

## 1. Reading the prior attempt

```
983507d 2026-04-27 11:57:31 -0500  revert: default outbound back to SDK.newCall (two-leg hits USER_BUSY)
990e5e6 2026-04-27 11:49:20 -0500  fix: harden outbound_dial auto-answer detection + add diagnostics
638e517 2026-04-27 11:43:39 -0500  feat: server-originated outbound calls (two-leg architecture for transfer)
03a2936 2026-04-27 11:22:56 -0500  chore: persist hangup_cause + hangup_source on call_logs
d1a6deb 2026-04-27 11:16:56 -0500  chore: log hangup_cause + hangup_source on call.hangup webhook
```

Window of the experiment: **11:43:39 → 11:57:31 CDT (= 16:43–16:57 UTC).** ~14 minutes total.

### 638e517 — feat: server-originated outbound

Files changed:
- `app/api/telnyx/dial-outbound/route.ts` — new file (220 lines)
- `app/hooks/useTelnyxClient.ts` — added auto-answer block in callUpdate handler
- `app/page.tsx` — `handleMakeCall` switched to POST `/api/telnyx/dial-outbound` (with `?legacy_dial=1` escape hatch)

Strategy:
1. **Leg A first (customer):** `POST /v2/calls` with `to=customerNumber, from=businessNumber, connection_id=TELNYX_CALL_CONTROL_APP_ID, record=record-from-answer`. No `bridge_on_answer`. Captures `customerCcid`.
2. **Leg B second (rep):** `POST /v2/calls` with `to=sip:<gencredXXX>@sip.telnyx.com, from=businessNumber, connection_id=TELNYX_CALL_CONTROL_APP_ID, link_to=customerCcid, bridge_on_answer=true, bridge_intent=true, timeout_secs=30, client_state=<base64 JSON {type:"outbound_dial", to, from, user_id}>`. Captures `repCcid`.
3. **Insert call_logs row** with `call_control_id=repCcid`, `external_ccid=customerCcid`.
4. **Client auto-answer:** SDK's `callUpdate` handler — when state=`ringing` and direction=`inbound`, decode `call.options?.clientState` (base64 → JSON), if `decoded.type==="outbound_dial"` then call `call.answer()` and silently set `direction="outbound"` on the SDK call object.

Critically: **no `auto_answer` Telnyx parameter, no custom SIP headers, no server-side delay.** The whole auto-answer mechanism leaned on `client_state` reaching the SDK.

### 990e5e6 — fix: harden auto-answer detection

Stephen reported the SDK was treating outbound calls as inbound. The hardening:
- Added a diagnostic dump of every incoming-call field the SDK exposes (`clientStateRaw`, `clientStateLen`, `callerNumber`, `destinationNumber`, `remoteCallerName`, `cause`).
- Tried both `opts.clientState` and `opts.client_state` field names.
- Tried both `JSON.parse(atob(cs))` and direct `JSON.parse(cs)` decoders.

This was a "let's see what's actually arriving" commit. It was deployed at 11:49 — **8 minutes before the revert**.

### 983507d — revert

Quoted from the commit message:

```
The new server-originated two-leg outbound architecture (commit 638e517)
fails on the rep's INVITE: Telnyx returns USER_BUSY when dialing the
rep's own SIP credential while the SDK is registered to it. The
credential's registration or concurrency setting flags it as busy so
the auto-answer code in useTelnyxClient never gets a chance to run.

Console diagnostic from Stephen's test:
  [Telnyx] callUpdate ringing inbound undefined
  [Call] outbound originated repCcid=... customerCcid=...
  [Telnyx] callUpdate hangup inbound USER_BUSY
  [Telnyx] callUpdate destroy inbound USER_BUSY
```

The revert flipped the default back to `SDK.newCall` and gated the new path behind `?new_dial=1`.

## 2. DB rows from the failure window

`hangup_cause` / `hangup_source` columns were added at **11:22 CDT** — 21 minutes BEFORE the two-leg deploy at 11:43. So the call.hangup data IS captured for the failure window. **This contradicts the revert message's framing — and it changes the diagnosis.**

### The actual sequence in the DB (16:43–17:00 UTC)

**Session a831beca-4258 (16:46:38 — first test):**

| ccid (short) | direction | from / to | duration | hangup_cause | hangup_source |
|---|---|---|---|---|---|
| `cqH_…` (repCcid) | outbound | +12514189329 → +12514425572 | (ringing, no row close) | — | — |
| `SuZeYlGu…` (customerCcid) | inbound | +12514425572 → +12514189329 | 22s | `normal_clearing` | **caller** |
| `sT0k9rt9…` (WebRTC INVITE) | inbound | gencredSkgd… → +12514189329 | 21s | `normal_clearing` | **callee** |
| `cqH_…` (peer-stamp dup) | inbound | (Unknown) | 22s | `normal_clearing` | **callee** |

**This first test SUCCEEDED.** Customer answered, conversation ran 21–22 seconds, customer (cell) hung up cleanly. The two-leg architecture worked end-to-end on the first attempt.

**Session bb6f8594-4258 (16:47:10 — ~10 sec after Session 1 ended):**

| ccid (short) | direction | from / to | duration | hangup_cause | hangup_source |
|---|---|---|---|---|---|
| `aWUZuv-…` (customer) | inbound | +12514425572 → +12514189329 | 25s | `normal_clearing` | callee |
| `1dRgoU5h…` (Leg B insert) | outbound | +12514189329 → +12514425572 | **3s** | **`user_busy`** | **`unknown`** |
| `RvVTrOfh…` (WebRTC INVITE) | inbound | gencredSkgd… → +12514189329 | **2s** | **`user_busy`** | **`unknown`** |

**Leg B (the SIP-INVITE-to-credential side) returned user_busy after 2–3 seconds.** Customer leg ran 25s alone, then ended.

**Session fa4c9d56 (16:48:55 — ~1.5 min later, dialed +13149543283):**

| ccid (short) | direction | from / to | duration | hangup_cause | hangup_source |
|---|---|---|---|---|---|
| `xnrFnCYV…` (Leg B insert) | outbound | +14694590748 → +13149543283 | 3s | **`user_busy`** | unknown |
| `j5_3mK27…` (customer) | inbound | +13149543283 → +14694590748 | 75s | `normal_clearing` | callee |
| `2OgQN2Z9…` (WebRTC INVITE) | inbound | gencredSkgd… → +14694590748 | 2s | **`user_busy`** | unknown |

Same shape — Leg B user_busy in 2–3s.

**Session 8c53cc6a (16:53:00 — 4 min after Session 3):**

| ccid (short) | direction | from / to | duration | hangup_cause | hangup_source |
|---|---|---|---|---|---|
| `EAvIafIx…` (Leg B insert) | outbound | +12514189329 → +12514425572 | 15s | **`user_busy`** | unknown |
| `VEr5OEn4…` (customer) | inbound | +12514425572 → +12514189329 | 39s | `normal_clearing` | callee |
| `-236Vm1I…` (WebRTC INVITE) | inbound | gencredSkgd… → +12514189329 | 15s | **`user_busy`** | unknown |

Same pattern — Leg B user_busy. (Slightly longer 15s before busy, but same outcome.)

### What the data actually says

The revert message's description ("the credential's registration or concurrency setting flags it as busy so the auto-answer code never gets a chance to run") is **partially right but missing the timing nuance**. The failure pattern is:

- **First call worked** (Session 1 at 16:46:38).
- **All subsequent calls** in the next 7+ minutes returned `user_busy` on the WebRTC INVITE leg, with `hangup_source=unknown`.

This is not a fundamental architecture failure. It's **post-call state cleanup**: after the first call, the rep's credential ends up in a state where it rejects new INVITEs as 486 BUSY. That state lasted for at least ~7 minutes (Session 4 was 4 minutes after Session 3 and still busy). It probably persisted until the SDK's WebRTC session re-registered or was hung up entirely.

`hangup_source=unknown` is the diagnostic giveaway — when Telnyx itself terminates a leg with USER_BUSY because the SIP endpoint refused with a 486, it doesn't have a clear caller/callee attribution, so it tags `unknown`.

## 3. Telnyx connection settings inspection

Two distinct Telnyx connection objects:

### Call Control App `2922071721655666224` ("Pepper")

- `inbound.channel_limit: null` (no limit)
- `inbound.sip_subdomain_receive_settings: "from_anyone"` — accepts SIP URI calls
- `outbound.channel_limit: null`
- `webhook_event_url: https://ava-softphone.vercel.app/api/telnyx/webhook` ✓
- `outbound.outbound_voice_profile_id: 2922100156520203555` (set)

### Credential Connection `2922066905319605801` ("Signal", `user_name=userriggs96197`)

- `sip_uri_calling_preference: "internal"` — accepts SIP URI INVITEs from internal sources (i.e., from a Call Control App originate). ✓ correct.
- `inbound.channel_limit: null`, `outbound.channel_limit: null` — no concurrency caps
- `inbound.simultaneous_ringing: "enabled"` — multiple registrations on the same AOR ring in parallel
- `inbound.default_routing_method: "sequential"`
- `webhook_event_url: https://ava-softphone.vercel.app/api/telnyx/webhook` ✓
- `registration_status: "Not Registered"` ← **not currently registered** (right now, no rep tab open). When a rep tab is open the SDK connects via this credential.
- `third_party_control_enabled: false`

**No connection-level setting accounts for the USER_BUSY pattern.** No max-calls cap, no rate limit. The rejection is happening downstream of these settings — at the WebRTC SDK / browser-tab side.

The **SDK source** (`@telnyx/webrtc/lib/bundle.js`) confirms an important detail: `client_state` IS read off the verto invite (`d.client_state && (l.clientState = d.client_state)`) AND `custom_headers` is also read (`l.customHeaders = d.dialogParams.custom_headers`). So both delivery mechanisms exist; whether Telnyx propagates `client_state` through this hop is the prior failure's open question.

## 4. Desired flow — confirmed/revised

The brief's flow is mostly correct. Two clarifications:

1. The `auto_answer_pending` parameter the brief mentions doesn't exist on Telnyx's `/v2/calls` — checked the API spec (no such field). The mechanism is either (a) `client_state` + SDK-side detection (prior attempt; client_state didn't surface), (b) `custom_headers` + SDK-side detection (untried; SDK source confirms this DOES surface), or (c) `auto_answer` on the inbound side for credential connections — but not on `/v2/calls` itself.
2. The ordering matters: **dialing Leg B too soon after a prior call's hangup is what triggered USER_BUSY.** The first call worked; later calls failed.

Revised desired flow:

1. Rep clicks Call on a prospect.
2. Client POSTs to `/api/telnyx/dial-outbound` with `{ to, from }`.
3. Server resolves rep's SIP address from `softphone_users.sip_username` (`sip:<gencred…>@sip.telnyx.com`).
4. Server creates Leg A: `POST /v2/calls` with `to=prospectPhone, from=businessNumber, connection_id=TELNYX_CALL_CONTROL_APP_ID, record=record-from-answer`. Capture `customerCcid`.
5. Server creates Leg B: `POST /v2/calls` with `to=sip:<gencred>@sip.telnyx.com, from=businessNumber, connection_id=TELNYX_CALL_CONTROL_APP_ID, link_to=customerCcid, bridge_on_answer=true, bridge_intent=true, timeout_secs=30, **custom_headers=[{name:"X-Pepper-Auto-Answer", value:"<repCcid or marker>"}]**`. Capture `repCcid`.
6. Server INSERTS one `call_logs` row: `direction='outbound'`, `call_control_id=repCcid`, `external_ccid=customerCcid`, `from_number=fromNumber`, `phone_number=prospectPhone`, `user_id=repUserId`, `status='ringing'`.
7. SDK receives INVITE — handler reads `call.options?.customHeaders` (NOT `clientState`), if `X-Pepper-Auto-Answer` header is present, immediately calls `call.answer()`.
8. Telnyx auto-bridges Leg A ↔ Leg B on answer.
9. Outbound transfer (blind/warm) now works via the existing inbound-style path because the row has `external_ccid` populated to the customer's leg.

What was WRONG with 638e517's flow that needs to be different:

- **Used `client_state` for auto-answer marker.** SDK source says it's supported, but Stephen's diagnostic showed `clientStateRaw: '(none)'` — Telnyx's verto invite for credential-targeted calls didn't include it. Switch to `custom_headers`, which the SDK source confirms IS surfaced.
- **No defense for post-call BUSY state.** Need to either guarantee the prior call's SDK object is fully torn down before re-dial, or detect/retry the BUSY response on Leg B.

## 5. Hypothesis on USER_BUSY (one paragraph)

**The USER_BUSY response on Leg B was not caused by Telnyx connection settings or the architecture itself — it was caused by the rep's WebRTC SDK (or its credential dialog state) holding onto a prior call long enough to reject the next INVITE with 486 BUSY.** Evidence: the very first test call in the failure window (Session 1 at 16:46:38, before any prior call's state was lingering) succeeded end-to-end with a 22-second answered conversation; only Session 2 (10 seconds later) and onward returned `user_busy` with `hangup_source=unknown` on the WebRTC leg. Telnyx's connection-level settings have no concurrency caps that explain this; it's a state issue at the SIP-dialog layer between Telnyx and the registered WebRTC client. The auto-answer mechanism (`client_state`) was a separate problem that wouldn't have mattered for Session 1 (which worked) — but the diagnostic from 990e5e6 showing `clientStateRaw: '(none)'` indicates `client_state` doesn't survive the credential-INVITE hop, which means the auto-answer was relying on a marker that never arrived; auto-answer should be re-implemented using `custom_headers` (which the SDK source confirms IS forwarded). Both fixes are needed: (a) `custom_headers` instead of `client_state` for the auto-answer marker, and (b) ensure the prior call's WebRTC dialog is fully terminated before the next dial-outbound is allowed (either via SDK-side `await call.hangup()` confirmation, an explicit `/v2/calls/{ccid}/actions/hangup` from the server, or a small server-side delay/retry on a 486).

---

## Phase 1A complete, awaiting direction on Phase 1B.

---

## Follow-ups (track here so they don't get lost)

### Track bridge-attempted state for blind-transfer outbound

Added 2026-04-29 alongside the originate-then-bridge refactor.

The `blind_xfer_failed` Realtime broadcast in
`app/api/telnyx/webhook/route.ts` (call.hangup handler) currently
broadcasts whenever the new leg's `hangup_cause` is in a wide failure
set including `normal_clearing`. False-positive risk on already-bridged
legs is low — by the time the toast lands, the rep's WebRTC has been
BYE'd and the UI is already cleared via the existing callUpdate hangup
handler — but it's still imprecise.

Proper fix: track explicitly whether `/actions/bridge` was attempted
(or completed) for each `client_state.type === "blind_xfer_bridge"`
new leg. On call.hangup, broadcast IF AND ONLY IF no bridge attempt
ever fired.

Options for state storage (no new tables required):

- Store `bridge_attempted_at` timestamp in a column on the new leg's
  `call_logs` row when call.answered fires the bridge.
- Or use a small `notes` field marker like `xfer:bridge_attempted`.

Either way, drops the `normal_clearing` entry from the failure set
and replaces the heuristic with an exact predicate.

Not blocking the originate-then-bridge ship — current behavior is
"correct but slightly noisy on an edge that doesn't materially affect
UX." Land it after the primary path is verified working in production.

If you approve continuing to Phase 1B I would propose, before writing code, to share an explicit implementation plan covering:

- Switch `client_state` → `custom_headers` for the auto-answer marker; SDK handler reads `call.options?.customHeaders` and matches on `X-Pepper-Auto-Answer`.
- Sequencing fix: in `useTelnyxClient.makeCall` (the dial-outbound caller), wait until the previous call's SDK object has fired `state="destroy"` before issuing a new POST. Alternatively, on USER_BUSY response from Leg B, retry once after 1.5s. (I'd want to actually test which is more reliable on a live tab.)
- Keep `?legacy_dial=1` (or `?new_dial=1`) opt-in behavior unchanged so we can A/B without redeploying.

But not writing any code until you confirm direction.

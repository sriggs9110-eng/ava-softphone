# Signal → Pepper integration (v1)

Pepper exposes a single entry point — a pop-up dialer at `/dial` — that
Signal (or any CRM) can open when a rep clicks a "call" button on a
prospect. The pop-up authenticates against the rep's Pepper account,
places the call through Telnyx WebRTC, and pushes call lifecycle events
back to Signal via `window.postMessage` while the pop-up is open and
via an optional HTTP webhook after it closes.

## 1. Opening the pop-up

```js
window.open(
  'https://trypepper.com/dial?' + new URLSearchParams({
    number: '+14694590748',
    name: 'Maria Jimenez',
    company: 'Willow Creek',
    external_id: 'prospect_123',
    return_url: 'https://signal.app/prospects/123',
  }).toString(),
  'pepper-dialer',
  'width=440,height=720'
);
```

A 440×720 window is the target; Pepper's layout is designed for it.

### Query parameters

| Name | Required | Purpose |
|------|----------|---------|
| `number` | yes | E.164 phone number to dial. If the rep has **Auto-dial pop-up** enabled in Settings → Integrations, the call starts 500ms after the WebRTC connection reports ready. Otherwise a "Call {name}" button is shown. |
| `name` | no | Prospect name. Rendered on the contact card at the top of the pop-up. |
| `company` | no | Organization. Rendered under the name. |
| `external_id` | no | Your CRM's opaque reference. Stored on the `call_logs` row and included in every `postMessage` event + the webhook callback. Use this to correlate back to Signal's own records. |
| `return_url` | no | If supplied, a small "Return" link is shown in the pop-up header. Clicking it navigates the parent window to this URL. |

If the rep isn't logged into Pepper, the pop-up redirects to
`/login?next=/dial?...` and returns to `/dial` with the same query string
after successful sign-in.

## 2. `postMessage` events (pop-up is open)

While the pop-up is open, Pepper posts events to `window.opener` with
`origin: '*'`. You can scope by `event.origin` on your end if you want
tighter control (it will be Pepper's origin).

Every payload contains `external_id` (may be `null` if not supplied) and
`call_log_id` so you can join updates back to a single call.

### `pepper:call_started`

Fires once when the call transitions to `active` state (prospect
answered).

```ts
{
  type: 'pepper:call_started',
  payload: {
    external_id: string | null,
    call_log_id: string | null,
    phone_number: string,
  }
}
```

### `pepper:call_ended`

Fires when the call hangs up (by either side). Recording and AI fields
are typically `null` here — they arrive later via `pepper:recording_ready`
(pop-up still open) or the webhook callback (pop-up already closed).

```ts
{
  type: 'pepper:call_ended',
  payload: {
    external_id: string | null,
    call_log_id: string | null,
    duration_seconds: number,
    recording_url: string | null,
    disposition: 'completed' | 'missed' | 'rejected' | 'voicemail' | 'no-answer',
    ai_score: number | null,
    ai_summary: string | null,
    transcript_url: string | null,
    phone_number: string,
  }
}
```

### `pepper:recording_ready`

Fires when Telnyx's `recording.saved` webhook has populated
`call_logs.recording_url` and Supabase Realtime has pushed the update to
the still-open pop-up. AI fields may also be populated if auto-analyze is
enabled and the Claude call has already returned.

```ts
{
  type: 'pepper:recording_ready',
  payload: {
    external_id: string | null,
    call_log_id: string,
    recording_url: string,
    ai_score: number | null,
    ai_summary: string | null,
    transcript_url: null, // reserved for future — currently transcripts live on the row
  }
}
```

## 3. Webhook callback (pop-up is closed)

If the rep closed the pop-up before AI finished, Pepper will POST a
summary to the URL the rep configured in **Settings → Integrations →
Signal webhook URL**. The body:

```ts
{
  type: 'pepper.call_updated',
  external_id: string | null,
  call_log_id: string,
  phone_number: string,
  direction: 'inbound' | 'outbound',
  duration_seconds: number,
  disposition: 'completed' | 'missed' | 'rejected' | 'voicemail' | 'no-answer',
  recording_url: string | null,
  ai_summary: string | null,
  ai_score: number | null,
  transcript_status: 'pending' | 'processing' | 'complete' | 'failed' | 'none',
  ai_status: 'pending' | 'processing' | 'complete' | 'failed' | 'none',
  created_at: string, // ISO timestamp
}
```

The callback is delivered at most once per call, after Claude has
returned. If Whisper or Claude fails, you may receive the callback with
`transcript_status` or `ai_status` set to `failed` — the rep can hit
"Retry" in the Pepper History page, which will re-run the pipeline and
re-fire the callback.

Your endpoint should be idempotent on `call_log_id`.

## 4. Listening in Signal

Minimal listener:

```js
const pepperWin = window.open(/* … */);

window.addEventListener('message', (event) => {
  if (!event.data || typeof event.data.type !== 'string') return;
  if (!event.data.type.startsWith('pepper:')) return;

  switch (event.data.type) {
    case 'pepper:call_started':
      // mark call-in-progress in Signal
      break;
    case 'pepper:call_ended':
      // log the attempt immediately with duration + disposition
      break;
    case 'pepper:recording_ready':
      // append recording link + AI score to the log entry
      break;
  }
});
```

## 5. What's deliberately not here (v1)

- **No public API keys, rate limiting, or signed requests.** The pop-up
  is the only surface. Any CRM can open it; the authentication is the
  rep's Pepper session.
- **No live / real-time transcription.** Transcription runs after the
  recording finishes via Telnyx → Whisper. Media streaming with Deepgram
  is on the roadmap.
- **`transcript_url`** is reserved in payloads but unused — transcripts
  are stored as text on `call_logs.transcript` today, not as a hosted
  file. If you need them in your CRM, `GET /api/call-logs/{id}` or a
  new transcript-fetch endpoint can be added later.

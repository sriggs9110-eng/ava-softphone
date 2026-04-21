# Voicemail end-to-end test

Ring-group voicemail is the first feature where Pepper acts on the call
server-side (answer → play → record) instead of just decorating WebRTC
state. This walkthrough exercises the full chain so you can catch
regressions before they reach agents.

**Prereqs** (one-time):
1. Migration applied: `supabase/migrations/20260426_voicemail.sql`
2. Storage bucket exists: `voicemail-greetings` (public). Auto-created by
   `npx tsx --env-file=.env.local scripts/setup-voicemail-bucket.ts`.
3. Env set in Vercel: `TELNYX_API_KEY`, `OPENAI_API_KEY`,
   `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`.

---

## 1. Record a greeting

1. Sign in as an admin.
2. **Settings → Ring Groups** → pick (or create) a group with an inbound
   number you can dial externally.
3. **Edit** the group. Set **Fallback** to **Voicemail**.
4. Scroll to the **Voicemail greeting** card.
5. Click **Record greeting**. Allow mic access if the browser prompts.
6. Say something short (~10 seconds). Click **Stop**.
7. Preview player appears below. Hit the built-in audio play button to
   confirm the recording is audible.
8. Click **Save greeting**. The "Current greeting" block should replace
   the preview.
9. (Optional) Try **Upload file** with any <2 MB mp3. Same result.

Verify in DB:
```
select id, name, fallback_action, voicemail_greeting_url, voicemail_greeting_filename
from ring_groups where id = '<your group id>';
```
`fallback_action` should be `voicemail`, `voicemail_greeting_url` should
resolve in a browser and play.

## 2. Make everyone unavailable

The voicemail path only fires when no ring-group member is reachable.
Simplest way:

- In Sidebar → avatar → status, switch every agent on that group to
  **Do Not Disturb**, or
- Remove all members from the group and save.

Without this step the WebRTC invite reaches an agent and the test flow
terminates at pickup.

## 3. Call the group from your cell

1. Dial the group's inbound number from an external phone.
2. You should hear silence for the ring timeout (default 20s).
3. After timeout, Telnyx answers and Pepper plays the greeting you
   recorded.
4. Immediately after the greeting ends, you'll hear a short silence —
   this is Telnyx starting the recording.
5. Leave a ~15-second message. Hang up when done (or wait up to 2 min;
   Telnyx auto-ends recordings at 120s).

## 4. Check the inbox

1. In Pepper, click the **Voicemails** icon in the sidebar. The unread
   badge should show 1 within a few seconds (Supabase Realtime).
2. Expand the row:
   - Audio player shows and plays your message.
   - Transcript block shows **Transcribing…** initially.
   - Within ~30 seconds it flips to the Whisper output.
3. If the transcript doesn't appear:
   - Check `/reports` → Ops health for `transcript_failed` counts.
   - Click **Retry** in the voicemail card; it re-hits
     `/api/ai/transcribe-voicemail` which refreshes the S3 URL via
     Telnyx first.

## 5. Action buttons

- **Call back**: closes the voicemail page, opens `/` with the dial pad
  pre-filled at the caller's number. Press the call button to dial out.
- **Mark handled**: prompts for an optional note, sets `status=handled`,
  records `handled_by` = your user, `handled_at` = now. The row moves
  into the **Handled** tab.
- **Ignore**: sets `status=ignored`; the row stays in **All** only.

## 6. What to check if things go wrong

| Symptom | Where to look |
|---|---|
| No voicemail row appears at all | Vercel logs for `[Webhook/ring]` — was the timeout handler hit? did `answer` succeed? |
| Caller hears nothing | `[Webhook/voicemail] playback_start status=` should be 200 |
| Voicemail row created but `recording_url` null | `call.recording.saved` webhook fired but `harvestVoicemailRecording` returned false. Check that the `ring_group_call_state` row for the ccid has `state='voicemail_recording'`. |
| Transcript stuck on `pending` | `/api/ai/transcribe-voicemail` wasn't hit — check `NEXT_PUBLIC_APP_URL` is set in Vercel. |
| Badge stays at 0 after new voicemail | Supabase Realtime replication isn't enabled for the `voicemails` table. Dashboard → Database → Replication → enable public.voicemails. |

## 7. State table

All flow state lives in `ring_group_call_state`, keyed on
`call_control_id`. Rows advance through:

```
voicemail_answering      ← timeout handler issued POST /answer
voicemail_playing_greeting ← call.answered received, playback_start issued
voicemail_recording      ← call.playback.ended received, record_start issued
done                     ← recording saved, voicemail row inserted
```

If you see stale rows with state != `done` from old tests, they're
harmless — they just never match a future ccid. Garbage-collect if
desired:
```
delete from ring_group_call_state where created_at < now() - interval '1 day';
```

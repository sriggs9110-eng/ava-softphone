-- The OTHER leg's call_control_id within the same call_session_id.
--
-- Telnyx's WebRTC outbound calls produce two legs sharing a session
-- but with distinct ccids: the rep's WebRTC leg and the carrier leg.
-- The browser SDK surfaces only the rep's leg. We need the carrier
-- leg's ccid to issue SIP REFER for blind transfer — REFER acts on the
-- leg whose far-side is the external party.
--
-- Populated by the call.bridged webhook handler: whenever an event's
-- ccid differs from the row's primary call_control_id within the same
-- session, we stamp it here.
ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS external_ccid text;

CREATE INDEX IF NOT EXISTS call_logs_external_ccid_idx
  ON call_logs (external_ccid)
  WHERE external_ccid IS NOT NULL;

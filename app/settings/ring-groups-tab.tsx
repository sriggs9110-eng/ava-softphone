"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Plus,
  Trash2,
  X,
  Edit3,
  Mic,
  Square,
  Upload,
  Play,
  RotateCw,
} from "lucide-react";

interface MemberRef {
  user_id: string;
  priority: number;
}

interface GroupRow {
  id: string;
  name: string;
  inbound_number: string;
  strategy: "simultaneous" | "round_robin";
  ring_timeout_seconds: number;
  fallback_action: "voicemail" | "hangup";
  voicemail_greeting_url: string | null;
  voicemail_greeting_filename: string | null;
  created_at: string;
  members: MemberRef[];
  member_count: number;
}

interface PoolRow {
  id: string;
  phone_number: string;
  area_code: string;
  label: string | null;
  is_active: boolean;
}

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

export default function RingGroupsTab() {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [pool, setPool] = useState<PoolRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<GroupRow | "new" | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [g, p, u] = await Promise.all([
      fetch("/api/admin/ring-groups").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/admin/phone-pool").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/admin/users").then((r) => (r.ok ? r.json() : [])),
    ]);
    setGroups(g);
    setPool(p);
    setUsers(u);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/admin/ring-groups?id=${id}`, {
      method: "DELETE",
    });
    if (res.ok) setGroups((prev) => prev.filter((g) => g.id !== id));
    setDeleteConfirm(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-slate" />
      </div>
    );
  }

  // Numbers already assigned to *some* group — excluded from the dropdown unless
  // it's the current group being edited.
  const assigned = new Set(groups.map((g) => g.inbound_number));

  return (
    <div>
      <p className="text-[13px] text-slate mb-4">
        When someone dials a ring group number, every Available member rings at
        once. First to answer wins.
      </p>

      <div className="flex justify-end mb-4">
        <button
          onClick={() => setEditing("new")}
          className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-banana border-[2.5px] border-navy text-navy text-sm font-bold transition-all min-h-[44px] shadow-pop-sm shadow-pop-hover"
        >
          <Plus size={16} />
          New ring group
        </button>
      </div>

      <div className="bg-paper border-[2.5px] border-navy rounded-[18px] overflow-hidden shadow-pop-md">
        <table className="w-full">
          <thead>
            <tr className="border-b-2 border-navy bg-cream-2">
              <Th>Name</Th>
              <Th>Number</Th>
              <Th>Strategy</Th>
              <Th>Members</Th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-slate text-sm">
                  No ring groups yet.
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <tr
                key={g.id}
                className="border-b border-navy/10 last:border-0 hover:bg-cream-3 transition-colors"
              >
                <td className="px-5 py-3.5 text-[14px] text-navy font-semibold">
                  {g.name}
                </td>
                <td className="px-5 py-3.5 text-[13px] text-navy-2 tabular-nums">
                  {g.inbound_number}
                </td>
                <td className="px-5 py-3.5 text-[12px]">
                  <span className="px-2 py-0.5 rounded-full bg-sky border-[1.5px] border-navy font-bold uppercase tracking-wider text-navy">
                    {g.strategy === "simultaneous" ? "Simultaneous" : "Round robin"}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-[13px] text-navy-2 tabular-nums">
                  {g.member_count}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <div className="flex items-center gap-2 justify-end">
                    {deleteConfirm === g.id ? (
                      <>
                        <button
                          onClick={() => handleDelete(g.id)}
                          className="px-2.5 py-1 rounded-full bg-coral border-2 border-navy text-white text-[11px] font-bold"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="px-2.5 py-1 rounded-full bg-paper border-2 border-navy text-navy text-[11px]"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setEditing(g)}
                          aria-label="Edit"
                          className="w-8 h-8 rounded-full border-2 border-navy flex items-center justify-center text-navy hover:bg-banana transition-colors"
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(g.id)}
                          aria-label="Delete"
                          className="w-8 h-8 rounded-full border-2 border-navy flex items-center justify-center text-navy hover:bg-coral hover:text-white transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing !== null && (
        <GroupModal
          existing={editing === "new" ? null : editing}
          pool={pool}
          users={users}
          assignedNumbers={assigned}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left px-5 py-3 text-[11px] text-navy uppercase tracking-wider font-bold">
      {children}
    </th>
  );
}

function GroupModal({
  existing,
  pool,
  users,
  assignedNumbers,
  onClose,
  onSaved,
}: {
  existing: GroupRow | null;
  pool: PoolRow[];
  users: UserRow[];
  assignedNumbers: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name || "");
  const [inbound, setInbound] = useState(existing?.inbound_number || "");
  const [strategy, setStrategy] = useState<"simultaneous" | "round_robin">(
    existing?.strategy || "simultaneous"
  );
  const [ringTimeout, setRingTimeout] = useState(
    existing?.ring_timeout_seconds ?? 20
  );
  const [fallback, setFallback] = useState<"voicemail" | "hangup">(
    existing?.fallback_action || "hangup"
  );
  const [members, setMembers] = useState<MemberRef[]>(existing?.members || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableNumbers = pool.filter(
    (p) => p.is_active && (!assignedNumbers.has(p.phone_number) || p.phone_number === existing?.inbound_number)
  );

  const toggleMember = (id: string) => {
    setMembers((prev) =>
      prev.some((m) => m.user_id === id)
        ? prev.filter((m) => m.user_id !== id)
        : [...prev, { user_id: id, priority: prev.length + 1 }]
    );
  };

  const setPriority = (id: string, priority: number) => {
    setMembers((prev) =>
      prev.map((m) => (m.user_id === id ? { ...m, priority } : m))
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !inbound) {
      setError("Name and inbound number are required.");
      return;
    }
    setSaving(true);
    setError(null);

    const body = {
      name: name.trim(),
      inbound_number: inbound,
      strategy,
      ring_timeout_seconds: ringTimeout,
      fallback_action: fallback,
      members,
    };

    const res = existing
      ? await fetch("/api/admin/ring-groups", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: existing.id, ...body }),
        })
      : await fetch("/api/admin/ring-groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to save");
      setSaving(false);
      return;
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-sm overflow-y-auto py-8">
      <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-6 max-w-lg w-full mx-4 animate-slide-up shadow-pop-lg">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-navy font-display">
            {existing ? "Edit ring group" : "New ring group"}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full border-2 border-navy flex items-center justify-center text-navy hover:bg-cream-2 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              className="w-full px-4 py-2.5 text-sm bg-cream-3 border-2 border-navy rounded-[10px] text-navy focus:outline-none focus:bg-banana/20"
              placeholder="Sales team"
            />
          </Field>

          <Field label="Inbound number">
            <select
              value={inbound}
              onChange={(e) => setInbound(e.target.value)}
              required
              className="w-full px-4 py-2.5 text-sm bg-cream-3 border-2 border-navy rounded-[10px] text-navy focus:outline-none cursor-pointer"
            >
              <option value="">Select a number…</option>
              {availableNumbers.map((p) => (
                <option key={p.id} value={p.phone_number}>
                  {p.phone_number}
                  {p.label ? ` — ${p.label}` : ""}
                </option>
              ))}
            </select>
            {availableNumbers.length === 0 && (
              <p className="text-[12px] text-slate mt-1">
                All active numbers are already assigned. Add one in the Phone
                Numbers tab first.
              </p>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Strategy">
              <div className="flex flex-col gap-2">
                <RadioRow
                  checked={strategy === "simultaneous"}
                  onChange={() => setStrategy("simultaneous")}
                  label="Simultaneous"
                />
                <RadioRow
                  checked={strategy === "round_robin"}
                  onChange={() => setStrategy("round_robin")}
                  label="Round robin"
                />
              </div>
            </Field>

            <Field label="Ring timeout (seconds)">
              <input
                type="number"
                min={5}
                max={120}
                value={ringTimeout}
                onChange={(e) => setRingTimeout(parseInt(e.target.value || "20", 10))}
                className="w-full px-4 py-2.5 text-sm bg-cream-3 border-2 border-navy rounded-[10px] text-navy focus:outline-none"
              />
            </Field>
          </div>

          <Field label="Fallback">
            <div className="flex flex-col gap-2">
              <RadioRow
                checked={fallback === "voicemail"}
                onChange={() => setFallback("voicemail")}
                label="Voicemail"
              />
              <RadioRow
                checked={fallback === "hangup"}
                onChange={() => setFallback("hangup")}
                label="Hang up"
              />
            </div>
          </Field>

          {fallback === "voicemail" && existing && (
            <Field label="Voicemail greeting">
              <GreetingRecorder
                groupId={existing.id}
                initialUrl={existing.voicemail_greeting_url}
                initialFilename={existing.voicemail_greeting_filename}
              />
            </Field>
          )}
          {fallback === "voicemail" && !existing && (
            <div className="text-[12px] text-slate bg-cream-2 border-2 border-navy rounded-[10px] px-3 py-2">
              Save the group first, then re-open to record or upload a
              voicemail greeting. Callers who time out without a greeting are
              hung up instead of recorded.
            </div>
          )}

          <Field label="Members">
            <div className="border-2 border-navy rounded-[10px] max-h-56 overflow-y-auto divide-y-2 divide-navy/10">
              {users.length === 0 && (
                <p className="px-3 py-3 text-slate text-[13px]">No users available.</p>
              )}
              {users.map((u) => {
                const m = members.find((mm) => mm.user_id === u.id);
                const picked = !!m;
                return (
                  <label
                    key={u.id}
                    className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${
                      picked ? "bg-banana/30" : "hover:bg-cream-3"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={picked}
                      onChange={() => toggleMember(u.id)}
                      className="accent-navy"
                    />
                    <span className="flex-1 text-[13px] text-navy font-medium">
                      {u.full_name}{" "}
                      <span className="text-slate text-[11px]">({u.email})</span>
                    </span>
                    {picked && strategy === "round_robin" && (
                      <input
                        type="number"
                        min={1}
                        value={m!.priority}
                        onChange={(e) =>
                          setPriority(u.id, parseInt(e.target.value || "1", 10))
                        }
                        className="w-14 px-2 py-1 text-[12px] bg-paper border-[1.5px] border-navy rounded text-navy text-center"
                        title="Priority (lower rings first)"
                      />
                    )}
                  </label>
                );
              })}
            </div>
          </Field>

          {error && (
            <div className="px-3 py-2.5 rounded-[10px] bg-rose border-2 border-navy text-navy text-[13px] font-medium">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-full bg-paper border-2 border-navy text-navy text-sm font-semibold min-h-[44px] shadow-pop-sm shadow-pop-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-full bg-banana border-[2.5px] border-navy text-navy text-sm font-bold disabled:opacity-50 min-h-[44px] shadow-pop-sm shadow-pop-hover"
            >
              {saving ? "Saving..." : existing ? "Save changes" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] text-navy uppercase tracking-wider font-bold mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function RadioRow({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-[13px] ${
        disabled ? "text-slate-2 cursor-not-allowed" : "text-navy cursor-pointer"
      }`}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="accent-navy"
      />
      {label}
    </label>
  );
}

/* ---------------- Greeting recorder ---------------- */

const MAX_RECORDING_SEC = 30;

function GreetingRecorder({
  groupId,
  initialUrl,
  initialFilename,
}: {
  groupId: string;
  initialUrl: string | null;
  initialFilename: string | null;
}) {
  const [storedUrl, setStoredUrl] = useState(initialUrl);
  const [storedFilename, setStoredFilename] = useState(initialFilename);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewFilename, setPreviewFilename] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopMediaTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const clearTimers = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    timerRef.current = null;
    autoStopRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
      stopMediaTracks();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = async () => {
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewBlob(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4",
      });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const mime = mr.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        const url = URL.createObjectURL(blob);
        setPreviewBlob(blob);
        setPreviewUrl(url);
        setPreviewFilename(
          `greeting-${new Date().toISOString().slice(0, 19)}.webm`
        );
        stopMediaTracks();
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed((e) => e + 1);
      }, 1000);
      autoStopRef.current = setTimeout(() => {
        stopRecording();
      }, MAX_RECORDING_SEC * 1000);
    } catch (err) {
      setError(
        "Microphone access denied or unavailable. " +
          ((err as Error).message || "")
      );
    }
  };

  const stopRecording = () => {
    clearTimers();
    setRecording(false);
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("File too large — max 2 MB");
      e.target.value = "";
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setPreviewBlob(file);
    setPreviewFilename(file.name);
  };

  const saveGreeting = async () => {
    if (!previewBlob) return;
    setSaving(true);
    setError(null);
    const form = new FormData();
    const filename = previewFilename || "greeting.webm";
    form.append("file", previewBlob, filename);
    const res = await fetch(`/api/admin/ring-groups/${groupId}/greeting`, {
      method: "POST",
      body: form,
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || `Save failed (${res.status})`);
      return;
    }
    const body = (await res.json()) as { url: string; filename: string };
    setStoredUrl(body.url);
    setStoredFilename(body.filename);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewBlob(null);
    setPreviewFilename(null);
  };

  const removeGreeting = async () => {
    if (!confirm("Remove the current greeting?")) return;
    setSaving(true);
    const res = await fetch(`/api/admin/ring-groups/${groupId}/greeting`, {
      method: "DELETE",
    });
    setSaving(false);
    if (res.ok) {
      setStoredUrl(null);
      setStoredFilename(null);
    }
  };

  return (
    <div className="bg-cream-3 border-2 border-navy rounded-[10px] p-3 space-y-3">
      {storedUrl && !previewUrl && (
        <div>
          <p className="text-[11px] text-navy uppercase tracking-wider font-bold mb-1">
            Current greeting
          </p>
          <div className="flex items-center gap-2">
            <audio controls src={storedUrl} className="h-8 flex-1" preload="metadata" />
          </div>
          <div className="flex items-center justify-between mt-2 text-[11px] text-slate">
            <span className="truncate">{storedFilename || "greeting"}</span>
            <button
              onClick={removeGreeting}
              disabled={saving}
              className="text-coral-deep hover:underline font-semibold"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!recording && !previewUrl && (
          <button
            type="button"
            onClick={startRecording}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-banana border-[2.5px] border-navy text-navy text-sm font-bold shadow-pop-sm shadow-pop-hover"
          >
            <Mic size={14} />
            {storedUrl ? "Record new" : "Record greeting"}
          </button>
        )}
        {recording && (
          <button
            type="button"
            onClick={stopRecording}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-coral border-[2.5px] border-navy text-white text-sm font-bold shadow-pop-sm"
          >
            <Square size={14} />
            Stop · {elapsed}s / {MAX_RECORDING_SEC}s
          </button>
        )}
        {!recording && !previewUrl && (
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-paper border-2 border-navy text-navy text-sm font-semibold shadow-pop-sm shadow-pop-hover cursor-pointer">
            <Upload size={14} />
            Upload file
            <input
              type="file"
              accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/x-m4a,audio/webm,audio/*"
              className="hidden"
              onChange={onFilePicked}
            />
          </label>
        )}
      </div>

      {previewUrl && (
        <div>
          <p className="text-[11px] text-navy uppercase tracking-wider font-bold mb-1">
            Preview
          </p>
          <audio controls src={previewUrl} className="h-8 w-full" preload="metadata" />
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button
              type="button"
              onClick={saveGreeting}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-leaf border-[2.5px] border-navy text-white text-[12px] font-bold shadow-pop-sm shadow-pop-hover disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              Save greeting
            </button>
            <button
              type="button"
              onClick={() => {
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                setPreviewUrl(null);
                setPreviewBlob(null);
                setPreviewFilename(null);
              }}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-paper border-2 border-navy text-navy text-[12px] font-semibold shadow-pop-sm shadow-pop-hover"
            >
              <RotateCw size={12} />
              Re-record
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-[11px] text-coral-deep font-semibold">{error}</p>
      )}
      <p className="text-[11px] text-slate leading-snug">
        Up to 30 seconds. Mention the company and ask the caller to leave a
        number, best time to call back, and the reason they&rsquo;re reaching
        out.
      </p>
    </div>
  );
}

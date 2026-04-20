"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, X, Edit3 } from "lucide-react";

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
                checked={fallback === "hangup"}
                onChange={() => setFallback("hangup")}
                label="Hang up"
              />
              <RadioRow
                checked={fallback === "voicemail"}
                onChange={() => setFallback("voicemail")}
                label="Voicemail (coming soon)"
                disabled
              />
            </div>
          </Field>

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

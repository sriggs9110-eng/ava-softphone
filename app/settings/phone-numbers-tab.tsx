"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";

interface PoolRow {
  id: string;
  phone_number: string;
  area_code: string;
  label: string | null;
  is_active: boolean;
  created_at: string;
}

export default function PhoneNumbersTab() {
  const [rows, setRows] = useState<PoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/phone-pool");
    if (res.ok) setRows(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (row: PoolRow) => {
    const next = !row.is_active;
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, is_active: next } : r))
    );
    const res = await fetch("/api/admin/phone-pool", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, is_active: next }),
    });
    if (!res.ok) load();
  };

  const deleteRow = async (id: string) => {
    const res = await fetch(`/api/admin/phone-pool?id=${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setRows((prev) => prev.filter((r) => r.id !== id));
    }
    setDeleteConfirm(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-slate" />
      </div>
    );
  }

  return (
    <div>
      <p className="text-[13px] text-slate mb-4">
        Numbers are purchased in Telnyx, then registered here to enable local
        presence dialing. Pepper picks the number whose area code matches the
        prospect before dialing out.
      </p>

      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-banana border-[2.5px] border-navy text-navy text-sm font-bold transition-all min-h-[44px] shadow-pop-sm shadow-pop-hover"
        >
          <Plus size={16} />
          Add number
        </button>
      </div>

      <div className="bg-paper border-[2.5px] border-navy rounded-[18px] overflow-hidden shadow-pop-md">
        <table className="w-full">
          <thead>
            <tr className="border-b-2 border-navy bg-cream-2">
              <Th>Number</Th>
              <Th>Area code</Th>
              <Th>Label</Th>
              <Th>Active</Th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-slate text-sm">
                  No numbers yet — add your first to enable local presence.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-navy/10 last:border-0 hover:bg-cream-3 transition-colors"
              >
                <td className="px-5 py-3.5 text-[14px] text-navy font-semibold tabular-nums">
                  {r.phone_number}
                </td>
                <td className="px-5 py-3.5 text-[13px] text-navy-2 tabular-nums">
                  {r.area_code}
                </td>
                <td className="px-5 py-3.5 text-[13px] text-navy-2">
                  {r.label || <span className="text-slate">—</span>}
                </td>
                <td className="px-5 py-3.5">
                  <button
                    onClick={() => toggleActive(r)}
                    aria-label={r.is_active ? "Deactivate" : "Activate"}
                    className={`relative w-12 h-[26px] rounded-full border-2 border-navy transition-colors ${
                      r.is_active ? "bg-leaf" : "bg-paper"
                    }`}
                  >
                    <span
                      className={`absolute top-[1px] w-[18px] h-[18px] rounded-full border-[1.5px] border-navy transition-all ${
                        r.is_active
                          ? "left-[26px] bg-paper"
                          : "left-[1px] bg-banana"
                      }`}
                    />
                  </button>
                </td>
                <td className="px-5 py-3.5 text-right">
                  {deleteConfirm === r.id ? (
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => deleteRow(r.id)}
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
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(r.id)}
                      className="w-8 h-8 rounded-full border-2 border-navy flex items-center justify-center text-navy hover:bg-coral hover:text-white transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <AddNumberModal
          onClose={() => setShowModal(false)}
          onCreated={() => {
            setShowModal(false);
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

function normalizeToE164(raw: string): { e164: string | null; area: string | null } {
  const digits = raw.replace(/\D/g, "");
  let e164: string | null = null;
  if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  else if (raw.startsWith("+") && digits.length >= 10) e164 = `+${digits}`;

  let area: string | null = null;
  if (e164) {
    const d = e164.replace(/\D/g, "");
    if (d.length === 11 && d.startsWith("1")) area = d.substring(1, 4);
    else if (d.length === 10) area = d.substring(0, 3);
  }
  return { e164, area };
}

function AddNumberModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [raw, setRaw] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { e164, area } = normalizeToE164(raw);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!e164) {
      setError("Enter a 10-digit US number or E.164 format.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/phone-pool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_number: e164, label: label || null }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to add");
      setSaving(false);
      return;
    }
    onCreated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-sm">
      <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-6 max-w-md w-full mx-4 animate-slide-up shadow-pop-lg">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-navy font-display">
            Add number
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full border-2 border-navy flex items-center justify-center text-navy hover:bg-cream-2 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Phone number">
            <input
              type="tel"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              required
              autoFocus
              className="w-full px-4 py-2.5 text-sm bg-cream-3 border-2 border-navy rounded-[10px] text-navy placeholder:text-slate-2 focus:outline-none focus:bg-banana/20"
              placeholder="+14694590748 or 469 459 0748"
            />
            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate">
              <span>
                E.164: <span className="text-navy font-semibold tabular-nums">{e164 || "—"}</span>
              </span>
              <span>
                Area: <span className="text-navy font-semibold tabular-nums">{area || "—"}</span>
              </span>
            </div>
          </Field>

          <Field label="Label (optional)">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full px-4 py-2.5 text-sm bg-cream-3 border-2 border-navy rounded-[10px] text-navy placeholder:text-slate-2 focus:outline-none focus:bg-banana/20"
              placeholder="Dallas 1"
            />
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
              {saving ? "Saving..." : "Add number"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] text-navy uppercase tracking-wider font-bold mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

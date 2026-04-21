"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, X, Check, AlertTriangle, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  extension: string | null;
  sip_username: string | null;
  sip_credential_id: string | null;
  sip_provisioned_at: string | null;
}

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-banana text-navy border-navy",
  manager: "bg-leaf text-white border-navy",
  agent: "bg-cream-2 text-navy border-navy",
};

const STATUS_DOT: Record<string, string> = {
  available: "bg-leaf",
  on_call: "bg-banana",
  after_call_work: "bg-slate-2",
  dnd: "bg-coral",
  offline: "bg-slate-2/40",
};

export default function UsersTab() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState<string | null>(null);
  const [provisionError, setProvisionError] = useState<Record<string, string>>({});

  const fetchUsers = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleRoleChange = async (id: string, role: string) => {
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, role }),
    });
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/admin/users?id=${id}`, { method: "DELETE" });
    setUsers((prev) => prev.filter((u) => u.id !== id));
    setDeleteConfirm(null);
  };

  const handleProvision = async (id: string) => {
    setProvisioning(id);
    setProvisionError((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const res = await fetch("/api/admin/users/provision-sip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProvisionError((prev) => ({
          ...prev,
          [id]: data.error || "Provision failed",
        }));
      } else {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === id
              ? {
                  ...u,
                  sip_username: data.sip_username,
                  sip_credential_id: data.credential_id,
                  sip_provisioned_at: new Date().toISOString(),
                }
              : u
          )
        );
      }
    } catch (err) {
      setProvisionError((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : "Network error",
      }));
    } finally {
      setProvisioning(null);
    }
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
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-banana border-[2.5px] border-navy text-navy text-sm font-bold transition-all min-h-[44px] shadow-pop-sm shadow-pop-hover"
        >
          <Plus size={16} />
          Add user
        </button>
      </div>

      <div className="bg-paper border-[2.5px] border-navy rounded-[18px] overflow-hidden shadow-pop-md">
        <table className="w-full">
          <thead>
            <tr className="border-b-2 border-navy bg-cream-2">
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>SIP</Th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                className="border-b border-navy/10 last:border-0 hover:bg-cream-3 transition-colors"
              >
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-full border-2 border-navy flex items-center justify-center text-[11px] font-bold ${
                        u.role === "admin"
                          ? "bg-banana text-navy"
                          : u.role === "manager"
                          ? "bg-leaf text-white"
                          : "bg-cream-2 text-navy"
                      }`}
                    >
                      {u.full_name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-[14px] font-semibold text-navy">
                      {u.full_name}
                    </span>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-[13px] text-navy-2">{u.email}</td>
                <td className="px-5 py-3.5">
                  {u.id === currentUser?.id ? (
                    <span
                      className={`px-2 py-0.5 rounded-full border-[1.5px] text-[10px] font-bold uppercase tracking-wider ${
                        ROLE_BADGE[u.role] || ROLE_BADGE.agent
                      }`}
                    >
                      {u.role}
                    </span>
                  ) : (
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      className="px-2 py-1 rounded-[8px] bg-cream-3 border-2 border-navy text-[12px] text-navy focus:outline-none cursor-pointer"
                    >
                      <option value="agent">Agent</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                  )}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2.5 h-2.5 rounded-full border border-navy ${
                        STATUS_DOT[u.status] || STATUS_DOT.offline
                      }`}
                    />
                    <span className="text-[12px] text-navy-2 capitalize">
                      {u.status.replace(/_/g, " ")}
                    </span>
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  <SipStatusCell
                    user={u}
                    provisioning={provisioning === u.id}
                    error={provisionError[u.id]}
                    onProvision={() => handleProvision(u.id)}
                  />
                </td>
                <td className="px-5 py-3.5 text-right">
                  {u.id !== currentUser?.id && (
                    <>
                      {deleteConfirm === u.id ? (
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={() => handleDelete(u.id)}
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
                          onClick={() => setDeleteConfirm(u.id)}
                          className="w-8 h-8 rounded-full border-2 border-navy flex items-center justify-center text-navy hover:bg-coral hover:text-white transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <AddUserModal
          onClose={() => setShowModal(false)}
          onCreated={() => {
            setShowModal(false);
            fetchUsers();
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

function SipStatusCell({
  user,
  provisioning,
  error,
  onProvision,
}: {
  user: UserRow;
  provisioning: boolean;
  error: string | undefined;
  onProvision: () => void;
}) {
  if (provisioning) {
    return (
      <div className="flex items-center gap-1.5 text-[12px] text-navy-2">
        <Loader2 size={13} className="animate-spin" />
        <span>Provisioning…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center gap-2">
        <span
          title={error}
          className="flex items-center gap-1 text-[12px] text-coral font-semibold"
        >
          <AlertTriangle size={13} />
          Failed
        </span>
        <button
          onClick={onProvision}
          className="px-2 py-0.5 rounded-full bg-banana border-[1.5px] border-navy text-navy text-[10px] font-bold flex items-center gap-1"
        >
          <RefreshCw size={10} />
          Retry
        </button>
      </div>
    );
  }
  if (user.sip_credential_id && user.sip_username) {
    return (
      <div className="flex items-center gap-1.5 text-[12px] text-leaf font-semibold">
        <Check size={13} />
        <span title={user.sip_username}>Provisioned</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1 text-[12px] text-navy-2/80">
        <AlertTriangle size={13} />
        Missing
      </span>
      <button
        onClick={onProvision}
        className="px-2 py-0.5 rounded-full bg-cream-3 border-[1.5px] border-navy text-navy text-[10px] font-bold"
      >
        Provision now
      </button>
    </div>
  );
}

function AddUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("agent");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, full_name: fullName, password, role }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to create user");
      setLoading(false);
      return;
    }

    // User created. If SIP credential provisioning failed the row still
    // exists and the Users table will surface a ⚠ Failed status with a
    // Retry button — no need to block the modal here.
    onCreated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-sm">
      <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-6 max-w-md w-full mx-4 animate-slide-up shadow-pop-lg">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-navy font-display">Add user</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full border-2 border-navy flex items-center justify-center text-navy hover:bg-cream-2 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Full name">
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              autoFocus
              className="w-full px-4 py-2.5 text-sm bg-cream-3 border-2 border-navy rounded-[10px] text-navy focus:outline-none focus:bg-banana/20"
              placeholder="John Doe"
            />
          </Field>

          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2.5 text-sm bg-cream-3 border-2 border-navy rounded-[10px] text-navy focus:outline-none focus:bg-banana/20"
              placeholder="john@company.com"
            />
          </Field>

          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-4 py-2.5 text-sm bg-cream-3 border-2 border-navy rounded-[10px] text-navy focus:outline-none focus:bg-banana/20"
              placeholder="••••••••"
            />
          </Field>

          <Field label="Role">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-4 py-2.5 text-sm bg-cream-3 border-2 border-navy rounded-[10px] text-navy focus:outline-none cursor-pointer"
            >
              <option value="agent">Agent</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
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
              disabled={loading}
              className="flex-1 py-2.5 rounded-full bg-banana border-[2.5px] border-navy text-navy text-sm font-bold disabled:opacity-50 min-h-[44px] shadow-pop-sm shadow-pop-hover"
            >
              {loading ? "Creating..." : "Create user"}
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

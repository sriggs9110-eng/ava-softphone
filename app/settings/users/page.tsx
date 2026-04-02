"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, X, ArrowLeft } from "lucide-react";
import Link from "next/link";

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  extension: string | null;
}

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-accent/15 text-accent border-accent/30",
  manager: "bg-green/15 text-green border-green/30",
  agent: "bg-text-tertiary/15 text-text-tertiary border-text-tertiary/30",
};

const STATUS_DOT: Record<string, string> = {
  available: "bg-green",
  on_call: "bg-amber",
  after_call_work: "bg-text-tertiary",
  dnd: "bg-red",
  offline: "bg-text-tertiary/40",
};

export default function UserManagementPage() {
  const { user: currentUser, isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    if (res.ok) {
      setUsers(await res.json());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push("/");
      return;
    }
    if (!authLoading && isAdmin) {
      fetchUsers();
    }
  }, [authLoading, isAdmin, router, fetchUsers]);

  const handleRoleChange = async (id: string, role: string) => {
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, role }),
    });
    setUsers((prev) =>
      prev.map((u) => (u.id === id ? { ...u, role } : u))
    );
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/admin/users?id=${id}`, { method: "DELETE" });
    setUsers((prev) => prev.filter((u) => u.id !== id));
    setDeleteConfirm(null);
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-bg-app flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-bg-app">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Link
            href="/"
            className="w-8 h-8 rounded-lg bg-bg-elevated flex items-center justify-center text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <ArrowLeft size={16} />
          </Link>
          <h1 className="text-xl font-semibold text-text-primary">
            User Management
          </h1>
        </div>
        <p className="text-[12px] text-text-tertiary mb-6 uppercase tracking-[0.5px] font-medium ml-11">
          Manage softphone users and roles
        </p>

        {/* Add user button */}
        <div className="flex justify-end mb-4">
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-all min-h-[44px]"
          >
            <Plus size={16} />
            Add User
          </button>
        </div>

        {/* Table */}
        <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="text-left px-5 py-3 text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
                  Name
                </th>
                <th className="text-left px-5 py-3 text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
                  Email
                </th>
                <th className="text-left px-5 py-3 text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
                  Role
                </th>
                <th className="text-left px-5 py-3 text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
                  Status
                </th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-border-subtle last:border-0 hover:bg-bg-elevated/50 transition-colors"
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold ${
                          u.role === "admin"
                            ? "bg-accent/15 text-accent"
                            : u.role === "manager"
                            ? "bg-green/15 text-green"
                            : "bg-bg-elevated text-text-secondary"
                        }`}
                      >
                        {u.full_name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-[14px] font-medium text-text-primary">
                        {u.full_name}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-[13px] text-text-secondary">
                    {u.email}
                  </td>
                  <td className="px-5 py-3.5">
                    {u.id === currentUser?.id ? (
                      <span
                        className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wider ${
                          ROLE_BADGE[u.role] || ROLE_BADGE.agent
                        }`}
                      >
                        {u.role}
                      </span>
                    ) : (
                      <select
                        value={u.role}
                        onChange={(e) =>
                          handleRoleChange(u.id, e.target.value)
                        }
                        className="px-2 py-1 rounded-lg bg-bg-elevated border border-border-subtle text-[12px] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 cursor-pointer"
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
                        className={`w-2 h-2 rounded-full ${
                          STATUS_DOT[u.status] || STATUS_DOT.offline
                        }`}
                      />
                      <span className="text-[12px] text-text-secondary capitalize">
                        {u.status.replace(/_/g, " ")}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {u.id !== currentUser?.id && (
                      <>
                        {deleteConfirm === u.id ? (
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={() => handleDelete(u.id)}
                              className="px-2.5 py-1 rounded-lg bg-red/10 text-red text-[11px] font-semibold hover:bg-red/20 transition-colors"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="px-2.5 py-1 rounded-lg bg-bg-elevated text-text-tertiary text-[11px] hover:bg-bg-hover transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(u.id)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-red hover:bg-red/10 transition-colors"
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

        {/* Add User Modal */}
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
      body: JSON.stringify({
        email,
        full_name: fullName,
        password,
        role,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to create user");
      setLoading(false);
      return;
    }

    onCreated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-app/80 backdrop-blur-sm">
      <div className="bg-bg-surface border border-border-subtle rounded-xl p-6 max-w-md w-full mx-4 animate-slide-up">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-text-primary">
            Add User
          </h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5">
              Full Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              autoFocus
              className="w-full px-4 py-2.5 text-sm bg-bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
              placeholder="John Doe"
            />
          </div>

          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2.5 text-sm bg-bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
              placeholder="john@company.com"
            />
          </div>

          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-4 py-2.5 text-sm bg-bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label className="block text-[12px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-4 py-2.5 text-sm bg-bg-elevated border border-border-subtle rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all cursor-pointer"
            >
              <option value="agent">Agent</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          {error && (
            <div className="px-3 py-2.5 rounded-lg bg-red/10 border border-red/20 text-red text-[13px]">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg bg-bg-elevated hover:bg-bg-hover text-text-secondary text-sm font-semibold transition-all min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-all disabled:opacity-50 min-h-[44px]"
            >
              {loading ? "Creating..." : "Create User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

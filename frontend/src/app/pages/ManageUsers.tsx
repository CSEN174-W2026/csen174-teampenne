import { useEffect, useMemo, useState } from "react";
import { createUser, deleteUser, listUsers, updateUser, type AuthUser } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";

type CreateForm = {
  email: string;
  password: string;
  full_name: string;
  is_admin: boolean;
  is_active: boolean;
};

export function ManageUsers() {
  const { token } = useAuth();
  const [rows, setRows] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateForm>({
    email: "",
    password: "",
    full_name: "",
    is_admin: false,
    is_active: true,
  });

  const canSubmit = useMemo(() => form.email.length > 3 && form.password.length >= 6, [form]);

  const refresh = async () => {
    if (!token) return;
    const res = await listUsers(token);
    setRows(res.rows);
  };

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    refresh()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load users");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!token) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Manage Users</h1>
        <p className="text-sm text-neutral-400">Create, update role, and deactivate users in Firebase Auth.</p>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="font-semibold mb-3">Create User</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
          />
          <input
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
            placeholder="Password (min 6)"
            type="password"
            value={form.password}
            onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
          />
          <input
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
            placeholder="Full name"
            value={form.full_name}
            onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
          />
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={form.is_admin}
              onChange={(e) => setForm((p) => ({ ...p, is_admin: e.target.checked }))}
            />
            Admin
          </label>
          <button
            disabled={!canSubmit}
            onClick={() => {
              setError(null);
              void createUser(token, form)
                .then(() => {
                  setForm({ email: "", password: "", full_name: "", is_admin: false, is_active: true });
                  return refresh();
                })
                .catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : "Failed to create user");
                });
            }}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3 py-2 text-sm font-medium"
          >
            Create
          </button>
        </div>
      </div>

      {error ? <div className="text-sm text-rose-300">{error}</div> : null}

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-950 text-neutral-400">
            <tr>
              <th className="text-left px-4 py-3">UID</th>
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Admin</th>
              <th className="text-left px-4 py-3">Active</th>
              <th className="text-left px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-4 text-neutral-400" colSpan={6}>
                  Loading users...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-neutral-400" colSpan={6}>
                  No users found.
                </td>
              </tr>
            ) : (
              rows.map((u) => (
                <tr key={u.id} className="border-t border-neutral-800">
                  <td className="px-4 py-3 font-mono text-xs">{u.id}</td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">{u.full_name || "—"}</td>
                  <td className="px-4 py-3">{u.is_admin ? "Yes" : "No"}</td>
                  <td className="px-4 py-3">{u.is_active ? "Yes" : "No"}</td>
                  <td className="px-4 py-3 flex gap-2">
                    <button
                      disabled={savingId === u.id}
                      className="rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800"
                      onClick={() => {
                        setSavingId(u.id);
                        setError(null);
                        void updateUser(token, u.id, { is_admin: !u.is_admin })
                          .then(refresh)
                          .catch((err: unknown) => {
                            setError(err instanceof Error ? err.message : "Failed to update user");
                          })
                          .finally(() => setSavingId(null));
                      }}
                    >
                      Toggle Admin
                    </button>
                    <button
                      disabled={savingId === u.id || !u.is_active}
                      className="rounded border border-rose-800 text-rose-300 px-2 py-1 hover:bg-rose-950 disabled:opacity-40"
                      onClick={() => {
                        setSavingId(u.id);
                        setError(null);
                        void deleteUser(token, u.id)
                          .then(refresh)
                          .catch((err: unknown) => {
                            setError(err instanceof Error ? err.message : "Failed to deactivate user");
                          })
                          .finally(() => setSavingId(null));
                      }}
                    >
                      Deactivate
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

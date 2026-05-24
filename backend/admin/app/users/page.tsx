"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import { fmt } from "@/lib/formatters";
import LoadingSpinner from "@/components/LoadingSpinner";
import Alert from "@/components/Alert";
import RequireAuth from "@/components/RequireAuth";
import { Modal } from "@/components/ui";
import { UserPlus, Trash2, Users, KeyRound } from "lucide-react";

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  created_at?: string;
}

export default function UsersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  // Add user form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addRole, setAddRole] = useState("admin");
  const [adding, setAdding] = useState(false);

  // Change-password modal
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [cpCurrent, setCpCurrent] = useState("");
  const [cpNew, setCpNew] = useState("");
  const [cpConfirm, setCpConfirm] = useState("");
  const [cpSubmitting, setCpSubmitting] = useState(false);
  const [cpError, setCpError] = useState("");

  async function loadUsers() {
    setLoading(true);
    setError("");
    try {
      // Get current user first
      const meRes = await api.get("/auth/me");
      setCurrentUserId(meRes.data?.user?.id || null);

      // Get all users
      const { data } = await api.get("/auth/users");
      setUsers(data.users || []);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal memuat daftar pengguna"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim() || !addEmail.trim() || !addPassword.trim()) {
      setError("Nama, email, dan password wajib diisi");
      return;
    }
    setAdding(true);
    setError("");
    setSuccess("");
    try {
      await api.post("/auth/register", {
        name: addName.trim(),
        email: addEmail.trim(),
        password: addPassword,
        role: addRole,
      });
      setSuccess("User berhasil ditambahkan");
      setAddName("");
      setAddEmail("");
      setAddPassword("");
      setShowAddForm(false);
      loadUsers();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal menambahkan user"));
    } finally {
      setAdding(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setCpError("");
    if (cpNew.length < 8) {
      setCpError("Password baru minimal 8 karakter");
      return;
    }
    if (cpNew !== cpConfirm) {
      setCpError("Konfirmasi password baru tidak cocok");
      return;
    }
    if (cpNew === cpCurrent) {
      setCpError("Password baru harus berbeda dari yang lama");
      return;
    }
    setCpSubmitting(true);
    try {
      await api.post("/auth/change-password", {
        currentPassword: cpCurrent,
        newPassword: cpNew,
      });
      // Backend invalidates session — force re-login
      setShowChangePwd(false);
      setCpCurrent("");
      setCpNew("");
      setCpConfirm("");
      router.replace("/login");
    } catch (e: unknown) {
      setCpError(getErrorMessage(e, "Gagal mengganti password"));
    } finally {
      setCpSubmitting(false);
    }
  }

  function resetChangePwdForm() {
    setShowChangePwd(false);
    setCpCurrent("");
    setCpNew("");
    setCpConfirm("");
    setCpError("");
  }

  async function handleDelete(user: User) {
    if (user.id === currentUserId) {
      setError("Tidak bisa menghapus diri sendiri");
      return;
    }
    if (!window.confirm(`Hapus user "${user.name}" (${user.email})?`)) return;

    setError("");
    setSuccess("");
    try {
      await api.delete(`/auth/users/${user.id}`);
      setSuccess(`User "${user.name}" berhasil dihapus`);
      loadUsers();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Gagal menghapus user"));
    }
  }

  return (
    <RequireAuth>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">User Management</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowChangePwd(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
            >
              <KeyRound className="h-4 w-4" />
              <span>Ganti Password</span>
            </button>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <UserPlus className="h-4 w-4" />
              <span>Tambah User</span>
            </button>
          </div>
        </div>

        {error && <Alert variant="error">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        {/* Add User Form */}
        {showAddForm && (
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-semibold mb-3">Tambah User Baru</h2>
            <form onSubmit={handleAddUser} className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <input
                type="text"
                placeholder="Nama"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                className="px-3 py-2 rounded-lg border border-border bg-background"
                required
              />
              <input
                type="email"
                placeholder="Email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                className="px-3 py-2 rounded-lg border border-border bg-background"
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={addPassword}
                onChange={(e) => setAddPassword(e.target.value)}
                className="px-3 py-2 rounded-lg border border-border bg-background"
                required
              />
              <select
                value={addRole}
                onChange={(e) => setAddRole(e.target.value)}
                className="px-3 py-2 rounded-lg border border-border bg-background"
              >
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="submit"
                disabled={adding}
                className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {adding ? "Menyimpan..." : "Simpan"}
              </button>
            </form>
          </div>
        )}

        {loading && <LoadingSpinner label="Memuat pengguna..." />}

        {!loading && (
          <div className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
            <div className="w-full max-w-full overflow-x-auto overscroll-x-contain">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-muted">
                    <th className="px-4 py-2 text-left">ID</th>
                    <th className="px-4 py-2 text-left">Nama</th>
                    <th className="px-4 py-2 text-left">Email</th>
                    <th className="px-4 py-2 text-left">Role</th>
                    <th className="px-4 py-2 text-left">Dibuat</th>
                    <th className="px-4 py-2 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        Tidak ada data pengguna
                      </td>
                    </tr>
                  ) : (
                    users.map((u) => (
                      <tr key={u.id} className="border-t border-border hover:bg-muted/50">
                        <td className="px-4 py-2">{u.id}</td>
                        <td className="px-4 py-2 font-medium">
                          {u.name}
                          {u.id === currentUserId && (
                            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                              Anda
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2">{u.email}</td>
                        <td className="px-4 py-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs ${
                              u.role === "admin"
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                                : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{fmt(u.created_at || null)}</td>
                        <td className="px-4 py-2 text-center">
                          {u.id !== currentUserId && (
                            <button
                              onClick={() => handleDelete(u)}
                              className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              title="Hapus user"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Total: {users.length} pengguna
        </p>

        <Modal
          isOpen={showChangePwd}
          onClose={resetChangePwdForm}
          title="Ganti Password Saya"
          size="sm"
        >
          <form onSubmit={handleChangePassword} className="space-y-3">
            {cpError && <Alert variant="error">{cpError}</Alert>}
            <div>
              <label className="block text-sm font-medium mb-1">Password Saat Ini</label>
              <input
                type="password"
                value={cpCurrent}
                onChange={(e) => setCpCurrent(e.target.value)}
                autoComplete="current-password"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Password Baru <span className="text-muted-foreground text-xs">(minimal 8 karakter)</span>
              </label>
              <input
                type="password"
                value={cpNew}
                onChange={(e) => setCpNew(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Konfirmasi Password Baru</label>
              <input
                type="password"
                value={cpConfirm}
                onChange={(e) => setCpConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
                required
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Setelah password diganti, Anda akan otomatis logout dan harus login ulang.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={resetChangePwdForm}
                disabled={cpSubmitting}
                className="px-4 py-2 rounded-lg border border-border hover:bg-muted disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={cpSubmitting}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {cpSubmitting ? "Mengganti…" : "Ganti Password"}
              </button>
            </div>
          </form>
        </Modal>
      </div>
    </RequireAuth>
  );
}

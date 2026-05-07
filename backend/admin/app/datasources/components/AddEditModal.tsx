"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import { DataSourceRow, DsType, PrepareResponse } from "../types";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  mode: "add" | "edit";
  editItem?: DataSourceRow;
};

const defaultForm: Partial<DataSourceRow> = {
  type: "dynamic",
  name: "",
  api_url: "",
  description: "",
  aliases: "",
  category: "",
  period_key: "th",
  auto_period: true,
  visible: true,
  status: true,
  display_order: 0,
};

export default function AddEditModal({ isOpen, onClose, onSuccess, onError, mode, editItem }: Props) {
  const [saving, setSaving] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [form, setForm] = useState<Partial<DataSourceRow>>(defaultForm);

  // Reset form when modal opens or mode/editItem changes
  useEffect(() => {
    if (isOpen) {
      if (mode === "edit" && editItem) {
        setForm({ ...editItem });
        setUrlInput(editItem.api_url || "");
      } else {
        setForm({ ...defaultForm });
        setUrlInput("");
      }
      setWarnings([]);
    }
  }, [isOpen, mode, editItem]);

  const title = mode === "add" ? "Tambah Datasource" : `Edit Datasource #${form.id}`;

  async function autoFillFromUrl() {
    onError("");
    setWarnings([]);

    const url = urlInput.trim();
    if (!url) {
      onError("URL wajib diisi");
      return;
    }

    const isPressReleaseUrl =
      /\/v1\/api\/list\/model\/pressrelease\//i.test(url) ||
      /\/v1\/api\/view\/.+\/model\/pressrelease\//i.test(url);
    if (isPressReleaseUrl) {
      onError("Press Release tidak ditambahkan lewat tombol Proses. Gunakan tombol 'Press Release'.");
      return;
    }

    try {
      const res = await api.post<PrepareResponse>("/datasource/prepare", { url });
      const payload = res.data;

      if (payload.detectedType === "exim") {
        onError("Tipe EXIM dibuat otomatis. Gunakan tombol Seed EXIM.");
        return;
      }

      setWarnings(Array.isArray(payload.warnings) ? payload.warnings : []);
      setForm((prev) => ({
        ...prev,
        ...payload.suggested,
        type: payload.detectedType,
      }));
    } catch (e: unknown) {
      onError(getErrorMessage(e, "Gagal memproses URL"));
    }
  }

  async function save() {
    setSaving(true);
    onError("");

    try {
      const nameFinal = String(form.name || "").trim();
      const apiUrlFinal = String(form.api_url || "").trim();
      const periodKeyFinal = String(form.period_key ?? "").trim();
      const aliasesFinal = String(form.aliases ?? "").trim();
      const categoryFinal = String(form.category ?? "").trim();
      const descriptionFinal = String(form.description ?? "").trim();

      if (!nameFinal) {
        onError("Nama wajib diisi");
        setSaving(false);
        return;
      }

      if (form.type !== "pressrelease" && !apiUrlFinal) {
        onError("API URL wajib diisi");
        setSaving(false);
        return;
      }

      const payload = {
        name: nameFinal,
        description: descriptionFinal || null,
        aliases: aliasesFinal || null,
        type: form.type,
        api_url: apiUrlFinal,
        period_key: periodKeyFinal || null,
        category: categoryFinal || null,
        auto_period: Boolean(form.auto_period),
        visible: Boolean(form.visible),
        status: Boolean(form.status),
        display_order: Number(form.display_order || 0),
      };

      if (mode === "add") {
        try {
          await api.post("/datasource", payload);
          onSuccess("Datasource berhasil ditambahkan");
        } catch (e: any) {
          const status = e?.response?.status;
          const data = e?.response?.data;

          if (status === 409 && data?.code === "DATASOURCE_NAME_EXISTS") {
            const matches = Array.isArray(data?.matches) ? data.matches : [];
            const matchText = matches.length ? ` (${matches.map((m: any) => `#${m.id}`).join(", ")})` : "";
            const ok = confirm(`Nama datasource sudah ada: "${payload.name}".${matchText}\n\nTetap lanjut?`);
            if (!ok) {
              setSaving(false);
              return;
            }
            await api.post("/datasource", { ...payload, force: true });
            onSuccess("Datasource berhasil ditambahkan (force)");
          } else {
            throw e;
          }
        }
      } else {
        await api.put(`/datasource/${form.id}`, payload);
        onSuccess("Datasource berhasil diupdate");
      }

      onClose();
    } catch (e: unknown) {
      onError(getErrorMessage(e, "Gagal menyimpan datasource"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg">
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">URL</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className="border rounded px-3 py-2 w-full"
              placeholder="Tempel URL di sini"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
            />
            <button className="px-3 py-2 rounded bg-gray-800 text-white w-full sm:w-auto" onClick={autoFillFromUrl}>
              Proses
            </button>
          </div>
          {warnings.length > 0 && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              {warnings.map((w, idx) => <div key={idx}>- {w}</div>)}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">Type</label>
            {form.type === "exim" || form.type === "pressrelease" ? (
              <input className="border rounded px-3 py-2 w-full bg-muted" value={String(form.type)} disabled />
            ) : (
              <select
                className="border rounded px-3 py-2 w-full"
                value={form.type || "dynamic"}
                onChange={(e) => {
                  const nextType = e.target.value as DsType;
                  setForm((p) => ({
                    ...p,
                    type: nextType,
                    period_key: nextType === "dynamic" ? "th" : nextType === "interop" ? "tahun" : "",
                    auto_period: nextType === "dynamic" || nextType === "interop",
                  }));
                }}
              >
                <option value="dynamic">dynamic</option>
                <option value="static">static</option>
                <option value="interop">interop</option>
              </select>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Period Key</label>
            <input
              className="border rounded px-3 py-2 w-full"
              value={String(form.period_key || "")}
              onChange={(e) => setForm((p) => ({ ...p, period_key: e.target.value }))}
              placeholder="th / tahun / (kosong)"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Nama</label>
            <input
              className="border rounded px-3 py-2 w-full"
              value={String(form.name || "")}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </div>

          {form.type !== "pressrelease" && (
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">Alias (untuk search)</label>
              <input
                className="border rounded px-3 py-2 w-full"
                value={String(form.aliases || "")}
                onChange={(e) => setForm((p) => ({ ...p, aliases: e.target.value }))}
                placeholder="Contoh: ntp, nilai tukar petani, tpk"
              />
              <div className="text-xs text-muted-foreground">Opsional. Pisahkan dengan koma/spasi.</div>
            </div>
          )}

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">API URL (template)</label>
            <input
              className="border rounded px-3 py-2 w-full"
              value={String(form.api_url || "")}
              onChange={(e) => setForm((p) => ({ ...p, api_url: e.target.value }))}
              placeholder=".../th/{period}/..."
              disabled={form.type === "pressrelease"}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Kategori</label>
            <input
              className="border rounded px-3 py-2 w-full"
              value={String(form.category || "")}
              onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Display Order</label>
            <input
              type="number"
              className="border rounded px-3 py-2 w-full"
              value={Number(form.display_order || 0)}
              onChange={(e) => setForm((p) => ({ ...p, display_order: Number(e.target.value) }))}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Deskripsi</label>
            <textarea
              className="border rounded px-3 py-2 w-full"
              rows={3}
              value={String(form.description || "")}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(form.visible)}
              onChange={(e) => setForm((p) => ({ ...p, visible: e.target.checked }))}
            />
            <span className="text-sm">Visible</span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(form.status)}
              onChange={(e) => setForm((p) => ({ ...p, status: e.target.checked }))}
            />
            <span className="text-sm">Status aktif</span>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-border flex flex-col-reverse sm:flex-row justify-end gap-2">
        <button className="px-3 py-2 rounded border" onClick={onClose} disabled={saving}>
          Batal
        </button>
        <button className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50" onClick={save} disabled={saving}>
          {saving ? "Menyimpan…" : "Simpan"}
        </button>
      </div>
    </Modal>
  );
}

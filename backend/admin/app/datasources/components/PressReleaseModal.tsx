"use client";

import { useState } from "react";
import { Modal } from "@/components/ui";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onRefresh: () => void;
};

export default function PressReleaseModal({ isOpen, onClose, onSuccess, onError, onRefresh }: Props) {
  const [form, setForm] = useState({
    name: "",
    keyword: "",
    visible: true,
    display_order: 0,
    category: "",
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!form.name.trim()) {
      onError("Nama wajib diisi");
      return;
    }
    if (!form.keyword.trim()) {
      onError("Keyword wajib diisi");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        type: "pressrelease",
        api_url: form.keyword.trim(),
        visible: form.visible,
        display_order: form.display_order || 0,
        category: form.category || null,
        auto_period: false,
        status: true,
      };

      await api.post("/datasource", payload);
      onSuccess(`Press Release "${form.name.trim()}" berhasil dibuat`);
      setForm({ name: "", keyword: "", visible: true, display_order: 0, category: "" });
      await onRefresh();
      onClose();
    } catch (e) {
      onError(getErrorMessage(e, "Gagal membuat Press Release"));
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    if (!saving) {
      setForm({ name: "", keyword: "", visible: true, display_order: 0, category: "" });
      onClose();
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Buat Press Release Baru" size="md">
      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Nama <span className="text-red-500">*</span></label>
          <input
            className="border rounded px-3 py-2 w-full"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Contoh: Press Release Inflasi"
            disabled={saving}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Keyword <span className="text-red-500">*</span></label>
          <input
            className="border rounded px-3 py-2 w-full"
            value={form.keyword}
            onChange={(e) => setForm({ ...form, keyword: e.target.value })}
            placeholder="Contoh: inflasi"
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">Keyword akan digunakan untuk query BRS API</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Kategori</label>
            <input
              className="border rounded px-3 py-2 w-full"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="Opsional"
              disabled={saving}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Display Order</label>
            <input
              type="number"
              className="border rounded px-3 py-2 w-full"
              value={form.display_order}
              onChange={(e) => setForm({ ...form, display_order: Number(e.target.value) || 0 })}
              disabled={saving}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="pr-visible"
            checked={form.visible}
            onChange={(e) => setForm({ ...form, visible: e.target.checked })}
            disabled={saving}
          />
          <label htmlFor="pr-visible" className="text-sm">Visible</label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button className="px-3 py-2 rounded border border-border" onClick={handleClose} disabled={saving}>
            Batal
          </button>
          <button className="px-3 py-2 rounded bg-emerald-600 text-white disabled:opacity-50" onClick={handleSave} disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

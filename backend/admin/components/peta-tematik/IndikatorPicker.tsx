"use client";

import { useState, useMemo } from "react";
import { Command } from "cmdk";
import { ChevronDown, Search } from "lucide-react";
import type { IndikatorList } from "./types";

interface Props {
  list: IndikatorList;
  value: number | null;
  onChange: (id: number) => void;
}

export default function IndikatorPicker({ list, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedName = useMemo(() => {
    for (const items of Object.values(list.kategori)) {
      const found = items.find(it => it.sourceId === value);
      if (found) return found.sourceName;
    }
    return "Pilih indikator…";
  }, [list, value]);

  const KATEGORI_ORDER = [
    "Kependudukan", "Ketenagakerjaan", "Pendidikan", "Kesehatan",
    "Ekonomi", "Pariwisata & Akomodasi", "Pembangunan & Sosial", "Lainnya",
  ];

  return (
    <div className="relative w-full sm:w-[480px]">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg
                   border border-border bg-background text-left text-sm
                   hover:bg-muted transition-colors"
      >
        <span className="truncate">{selectedName}</span>
        <ChevronDown className="h-4 w-4 flex-shrink-0 text-gray-400" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <Command className="absolute z-20 mt-2 w-full bg-background border border-border
                              rounded-lg shadow-lg overflow-hidden">
            <div className="flex items-center gap-2 px-3 border-b border-border">
              <Search className="h-4 w-4 text-gray-400" />
              <Command.Input
                placeholder="Cari indikator…"
                value={query}
                onValueChange={setQuery}
                className="w-full py-2 text-sm bg-transparent outline-none"
              />
            </div>
            <Command.List className="max-h-[400px] overflow-y-auto py-2">
              <Command.Empty className="py-4 text-center text-sm text-gray-500">
                Tidak ada hasil.
              </Command.Empty>
              {KATEGORI_ORDER.filter(k => list.kategori[k]?.length > 0).map(kategori => (
                <Command.Group
                  key={kategori}
                  heading={`${kategori} (${list.kategori[kategori].length})`}
                  className="text-xs text-gray-500 [&_[cmdk-group-heading]]:px-3
                             [&_[cmdk-group-heading]]:py-1
                             [&_[cmdk-group-heading]]:font-semibold
                             [&_[cmdk-group-heading]]:uppercase"
                >
                  {list.kategori[kategori].map(item => (
                    <Command.Item
                      key={item.sourceId}
                      value={item.sourceName}
                      onSelect={() => {
                        onChange(item.sourceId);
                        setOpen(false);
                        setQuery("");
                      }}
                      className="px-3 py-2 text-sm cursor-pointer
                                 aria-selected:bg-blue-50 aria-selected:text-blue-700"
                    >
                      {item.sourceName}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </>
      )}
    </div>
  );
}

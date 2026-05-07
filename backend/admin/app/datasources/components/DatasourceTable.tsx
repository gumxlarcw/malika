"use client";

import { DataSourceRow } from "../types";
import { DataTable } from "@/components/ui";
import type { Column } from "@/components/ui/DataTable";

type Props = {
  items: DataSourceRow[];
  loading: boolean;
  onEdit: (ds: DataSourceRow) => void;
  onDelete: (ds: DataSourceRow) => void;
  onHardDelete?: (ds: DataSourceRow) => void;
};

export default function DatasourceTable({ items, loading, onEdit, onDelete, onHardDelete }: Props) {
  const columns: Column<DataSourceRow>[] = [
    {
      key: "id",
      label: "ID",
      render: (ds) => <span className="font-mono text-xs">{ds.id}</span>,
    },
    {
      key: "name",
      label: "Nama",
      render: (ds) => (
        <div>
          <div className="font-medium">{ds.name}</div>
          {ds.category && <div className="text-xs text-muted-foreground">{ds.category}</div>}
        </div>
      ),
    },
    {
      key: "type",
      label: "Type",
      render: (ds) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getTypeColor(ds.type)}`}>
          {ds.type}
        </span>
      ),
    },
    {
      key: "visible",
      label: "Visible",
      render: (ds) => (
        <span className={ds.visible ? "text-green-600" : "text-red-500"}>
          {ds.visible ? "YA" : "TIDAK"}
        </span>
      ),
    },
    {
      key: "actions",
      label: "Aksi",
      render: (ds) => (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            className="px-3 py-1 rounded bg-gray-800 text-white text-xs"
            onClick={(e) => { e.stopPropagation(); onEdit(ds); }}
          >
            Edit
          </button>
          <button
            className="px-3 py-1 rounded bg-red-600 text-white text-xs"
            onClick={(e) => { e.stopPropagation(); onDelete(ds); }}
          >
            Delete
          </button>
          {onHardDelete && (
            <button
              className="px-3 py-1 rounded border border-red-500 text-red-600 text-xs"
              onClick={(e) => { e.stopPropagation(); onHardDelete(ds); }}
            >
              Hard Delete
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={items}
      keyField="id"
      loading={loading}
      loadingRows={10}
      emptyMessage="Belum ada data"
    />
  );
}

function getTypeColor(type: string): string {
  switch (type) {
    case "dynamic":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
    case "interop":
      return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    case "exim":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    case "pressrelease":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400";
    case "static":
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

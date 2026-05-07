"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type TableDensity = "comfortable" | "compact";

type DatasourceFilters = {
  category: string;
  type: string;
};

type FetchLogsFilters = {
  sourceId: string;
  status: "" | "success" | "error";
};

type AuditLogsFilters = {
  userId: string;
  action: string;
  resource: string;
  statusCode: string;
  q: string;
};

type ChatFilters = {
  owner: string;
};

type UiState = {
  sidebarCollapsed: boolean;
  tableDensity: TableDensity;
  datasourceFilters: DatasourceFilters;
  fetchLogsFilters: FetchLogsFilters;
  auditLogsFilters: AuditLogsFilters;
  chatFilters: ChatFilters;
  setSidebarCollapsed: (value: boolean) => void;
  toggleTableDensity: () => void;
  setDatasourceFilters: (partial: Partial<DatasourceFilters>) => void;
  setFetchLogsFilters: (partial: Partial<FetchLogsFilters>) => void;
  setAuditLogsFilters: (partial: Partial<AuditLogsFilters>) => void;
  setChatFilters: (partial: Partial<ChatFilters>) => void;
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      tableDensity: "comfortable",
      datasourceFilters: { category: "__all__", type: "__all__" },
      fetchLogsFilters: { sourceId: "", status: "" },
      auditLogsFilters: { userId: "", action: "", resource: "", statusCode: "", q: "" },
      chatFilters: { owner: "" },
      setSidebarCollapsed: (value) => set({ sidebarCollapsed: value }),
      toggleTableDensity: () =>
        set((state) => ({
          tableDensity: state.tableDensity === "compact" ? "comfortable" : "compact",
        })),
      setDatasourceFilters: (partial) =>
        set((state) => ({
          datasourceFilters: { ...state.datasourceFilters, ...partial },
        })),
      setFetchLogsFilters: (partial) =>
        set((state) => ({
          fetchLogsFilters: { ...state.fetchLogsFilters, ...partial },
        })),
      setAuditLogsFilters: (partial) =>
        set((state) => ({
          auditLogsFilters: { ...state.auditLogsFilters, ...partial },
        })),
      setChatFilters: (partial) =>
        set((state) => ({
          chatFilters: { ...state.chatFilters, ...partial },
        })),
    }),
    {
      name: "admin-ui-preferences",
      storage: createJSONStorage(() => localStorage),
    }
  )
);

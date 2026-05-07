import type { GeoJsonObject } from "geojson";

export type UploadResponse = {
  ok: boolean;
  filename?: string;
  url?: string;
  size_bytes?: number | null;
  message?: string;
};

export type GeoJsonListItem = {
  filename: string;
  url: string;
  size_bytes: number;
  size_human?: string;
  updated_at: string | null;
};

export type ListResponse = {
  ok: boolean;
  items?: GeoJsonListItem[];
  message?: string;
};

export type DeleteResponse = {
  ok: boolean;
  filename?: string;
  message?: string;
};

export type AdminRawResponse = {
  ok: boolean;
  filename?: string;
  geojson?: GeoJsonObject;
  message?: string;
};

export type UpdatePropertiesResponse = {
  ok: boolean;
  filename?: string;
  changed_features?: number;
  total_features?: number;
  url?: string;
  message?: string;
};

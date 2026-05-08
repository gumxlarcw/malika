/**
 * Chat constants and configuration
 * Extracted from ChatPageClient.tsx for centralized management
 */

// API Configuration
export const CHAT_API_BASE = "/api/chat";
export const BPS_API_BASE = "https://webapi.bps.go.id/v1/api";

// Model display names — SINGLE SOURCE OF TRUTH for frontend
// Backend equivalent is in config.js MODEL_ALIASES
export const MODEL_ALIASES: Record<string, string> = {
  'claude-sonnet-4-6': 'MALIKA Deep',
  'claude-haiku-4-5': 'MALIKA Flash',
} as const;

// Get BPS API key from environment (single source of truth)
// All other files should import this function instead of hardcoding.
export function getBpsApiKey(): string {
  const key = process.env.NEXT_PUBLIC_BPS_API_KEY;
  if (!key) {
    // BPS_API_KEY must be set via NEXT_PUBLIC_BPS_API_KEY env var
    if (typeof window !== 'undefined') {
      console.warn('[MALIKA] BPS API key not set in env — set NEXT_PUBLIC_BPS_API_KEY');
    }
    return "";
  }
  return key;
}

// UI Text (Indonesian)
export const CHAT_TEXT = {
  // Common
  loading: "Memuat...",
  error: "Terjadi kesalahan",
  close: "Tutup",
  cancel: "Batal",
  confirm: "Konfirmasi",
  retry: "Coba lagi",
  
  // Thread sidebar
  newChat: "Chat Baru",
  noThreads: "Belum ada percakapan",
  deleteThread: "Hapus percakapan ini?",
  threadDeleted: "Percakapan dihapus",
  
  // Messages
  typingIndicator: "Sedang mengetik...",
  thinking: "Sedang berpikir...",
  analyzing: "Menganalisis data...",
  searching: "Mencari informasi...",
  sendMessage: "Kirim pesan",
  inputPlaceholder: "Tanyakan tentang data...",
  
  // Knowledge/Documents
  loadingDocument: "Memuat dokumen...",
  documentNotFound: "Dokumen tidak ditemukan",
  downloadPdf: "Unduh PDF",
  pdfNotAvailable: "Preview PDF tidak tersedia",
  loadingPdf: "Memuat PDF",
  
  // Data preview
  viewFullTable: "Lihat Tabel Lengkap",
  copyTable: "Salin Tabel",
  tableCopied: "Tabel disalin!",
  noDataAvailable: "Data tidak tersedia untuk ditampilkan.",
  
  // Feedback
  feedbackLabel: "Respons ini:",
  feedbackThanks: "Terima kasih!",
  feedbackHelpful: "Respons membantu",
  feedbackNotHelpful: "Respons kurang membantu",
  
  // Sources
  references: "Referensi",
  relevancePercent: "relevan",
  
  // Document types
  brs: "Berita Resmi Statistik",
  publication: "Publikasi",
  
  // Confidence levels
  confidenceHigh: "Tinggi",
  confidenceMedium: "Sedang",
  confidenceLow: "Rendah",
  
  // Quick replies
  showMore: "Tampilkan lebih banyak",
  showLess: "Tampilkan lebih sedikit",
  
  // Export
  exportChat: "Ekspor Chat",
  exportJson: "Ekspor JSON",
  
  // Voice input
  voiceInput: "Input suara",
  listening: "Mendengarkan...",
  
  // Errors
  networkError: "Gagal menghubungi server",
  parseError: "Gagal memproses respons",
  sessionExpired: "Sesi berakhir, silakan muat ulang",
} as const;

// Animation timing
export const ANIMATION = {
  typingInterval: 14,
  typingStep: 1,
  thinkingDelayMs: 500,
  fadeInMs: 200,
  fadeOutMs: 150,
} as const;

// Limits
export const LIMITS = {
  maxMessageLength: 4000,
  maxQuickReplies: 8,
  maxSources: 6,
  maxAbstractBullets: 6,
  previewRowsLimit: 10,
  chatHistoryLimit: 50,
} as const;

// Legacy flat prompt list — kept for any other consumers
export const WELCOME_PROMPTS = [
  { icon: "📊", label: "Inflasi terbaru Maluku Utara" },
  { icon: "📉", label: "Angka kemiskinan 2025" },
  { icon: "🚢", label: "Data ekspor impor" },
  { icon: "👷", label: "Tingkat pengangguran" },
] as const;

// Categorized sample queries for the redesigned EmptyState
// (from Claude Design "Chat MALIKA" handoff bundle, chat-data.jsx)
export type SampleQueryCategory = {
  id: "demografi" | "ekonomi" | "sosial" | "inflasi";
  label: string;
  iconKey: "users" | "trending" | "heart" | "gauge";
  color: "sky" | "emerald" | "rose" | "violet";
  examples: string[];
};

export const SAMPLE_QUERIES: readonly SampleQueryCategory[] = [
  {
    id: "demografi",
    label: "Demografi",
    iconKey: "users",
    color: "sky",
    examples: [
      "Berapa jumlah penduduk Maluku Utara terbaru?",
      "Kepadatan penduduk per kabupaten/kota",
      "Komposisi umur penduduk Halmahera Utara",
    ],
  },
  {
    id: "ekonomi",
    label: "Ekonomi",
    iconKey: "trending",
    color: "emerald",
    examples: [
      "Pertumbuhan PDRB Maluku Utara 2024",
      "Sektor utama PDRB Kota Ternate",
      "Ekspor nikel Maluku Utara per bulan",
    ],
  },
  {
    id: "sosial",
    label: "Sosial",
    iconKey: "heart",
    color: "rose",
    examples: [
      "Tingkat kemiskinan per kabupaten/kota",
      "IPM Maluku Utara 5 tahun terakhir",
      "Tingkat pengangguran terbuka",
    ],
  },
  {
    id: "inflasi",
    label: "Harga & Inflasi",
    iconKey: "gauge",
    color: "violet",
    examples: [
      "Inflasi Kota Ternate bulan ini",
      "Tren inflasi Maluku Utara 2024",
      "Komoditas penyumbang inflasi terbesar",
    ],
  },
] as const;

// Contact info (centralized)
export const WHATSAPP_LINK = "https://wa.me/6285176764422";
export const WHATSAPP_DEFAULT_MESSAGE = "Halo%20BPS%20Malut%2C%20saya%20butuh%20bantuan%20mencari%20data";

// Local storage keys
export const STORAGE_KEYS = {
  chatHistory: "malika_chat_history",
  draftMessage: "malika_draft_message",
  preferredThread: "malika_preferred_thread",
  voiceEnabled: "malika_voice_enabled",
} as const;

// SSE Event types
export const SSE_EVENTS = {
  chunk: "chunk",
  done: "done",
  error: "error",
  metadata: "metadata",
} as const;

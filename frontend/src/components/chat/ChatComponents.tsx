"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

// ============================================================================
// Types
// ============================================================================

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: Date;
  isStreaming?: boolean;
  metadata?: Record<string, unknown>;
};

export type StreamEvent = {
  event: string;
  data: Record<string, unknown>;
};

type SpeechRecognitionResultEntry = {
  transcript?: string;
};

type SpeechRecognitionResultItem = ArrayLike<SpeechRecognitionResultEntry>;

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultItem>;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

// ============================================================================
// Streaming Hook
// ============================================================================

export function useStreamingChat({
  apiEndpoint,
  threadId,
  headers = {},
  onMessage,
  onError,
  onComplete,
}: {
  apiEndpoint: string;
  threadId: number | null;
  headers?: Record<string, string>;
  onMessage?: (content: string) => void;
  onError?: (error: Error) => void;
  onComplete?: (fullText: string) => void;
}) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedContent, setStreamedContent] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (text: string): Promise<string> => {
      if (!threadId || !text.trim()) {
        return "";
      }

      setIsStreaming(true);
      setStreamedContent("");

      const controller = new AbortController();
      abortControllerRef.current = controller;

      let fullText = "";

      try {
        const response = await fetch(
          `${apiEndpoint}/threads/${threadId}/stream`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...headers,
            },
            body: JSON.stringify({ text }),
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed.startsWith("event: ")) {
              // Parse event type
              continue;
            }

            if (trimmed.startsWith("data: ")) {
              try {
                const data = JSON.parse(trimmed.slice(6));

                if (data.content) {
                  fullText += data.content;
                  setStreamedContent(fullText);
                  onMessage?.(data.content);
                }

                if (data.full_text) {
                  fullText = data.full_text;
                  onComplete?.(fullText);
                }

                if (data.message) {
                  // Error message
                  onError?.(new Error(data.message));
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }

        return fullText;
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          onError?.(error);
          // If we have partial content, mark it as incomplete
          if (fullText.length > 0) {
            fullText += '\n\n⚠️ *Respons mungkin tidak lengkap karena gangguan koneksi*';
            setStreamedContent(fullText);
          }
        }
        return fullText;
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [apiEndpoint, threadId, headers, onMessage, onError, onComplete]
  );

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return {
    sendMessage,
    abort,
    isStreaming,
    streamedContent,
  };
}

// ============================================================================
// Chat Components
// ============================================================================

export function ChatContainer({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex h-full flex-col overflow-hidden bg-white dark:bg-gray-900 ${className}`}
    >
      {children}
    </div>
  );
}

export function ChatMessages({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (shouldAutoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [children, shouldAutoScroll]);

  // Detect if user has scrolled up
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    setShouldAutoScroll(isNearBottom);
  };

  const handleScrollToBottom = () => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
    setShouldAutoScroll(true);
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`relative flex-1 overflow-y-auto px-4 py-4 ${className}`}
    >
      <div className="mx-auto max-w-3xl space-y-4">{children}</div>
      {!shouldAutoScroll && (
        <div className="sticky bottom-4 flex w-full justify-end">
          <button
            type="button"
            onClick={handleScrollToBottom}
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            Ke bawah
          </button>
        </div>
      )}
    </div>
  );
}

export function MessageBubble({
  role,
  children,
  isStreaming = false,
  className = "",
}: {
  role: "user" | "assistant";
  children: React.ReactNode;
  isStreaming?: boolean;
  className?: string;
}) {
  const isUser = role === "user";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} ${className}`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-brand-500 text-white"
            : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100"
        } ${isStreaming ? "animate-pulse" : ""}`}
      >
        <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
          {children}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Message Formatting
// ============================================================================

const URL_REGEX = /https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gi;
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"];

function extractUrls(text: string) {
  const urls = text.match(URL_REGEX) || [];
  const unique = Array.from(new Set(urls));

  const images = unique.filter((url) =>
    IMAGE_EXTENSIONS.some((ext) => url.toLowerCase().includes(ext))
  );

  const links = unique.filter((url) => !images.includes(url));

  return { images, links };
}

function LinkPreview({ url }: { url: string }) {
  let hostname = url;
  let path = "";
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname.replace(/^www\./, "");
    path = parsed.pathname.length > 1 ? parsed.pathname : "";
  } catch {
    // ignore
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-[11px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        {hostname.slice(0, 2).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{hostname}</span>
        {path && (
          <span className="block truncate text-[11px] text-gray-400">{path}</span>
        )}
      </span>
      <svg className="h-3.5 w-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}

export function MessageContent({ content }: { content: string }) {
  const { images, links } = useMemo(() => extractUrls(content), [content]);

  return (
    <div className="space-y-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 underline decoration-dotted underline-offset-4 hover:text-brand-700"
            >
              {children}
            </a>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg bg-gray-900/90 p-3 text-xs text-gray-100">
              {children}
            </pre>
          ),
          code: ({ className, children, ...rest }) => {
            // react-markdown v10 removed `inline` prop — detect block code via
            // className from rehype-highlight (adds "hljs" / "language-*")
            const isBlock = className && /hljs|language-/.test(className);
            if (isBlock) {
              return (
                <code className={`text-xs ${className}`}>
                  {children}
                </code>
              );
            }
            // Inline code (backtick `code`)
            return (
              <code className="rounded bg-gray-200 px-1 py-0.5 text-[11px] text-gray-800 dark:bg-gray-800 dark:text-gray-100">
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-gray-200 bg-gray-50 px-2 py-1 text-left text-[11px] font-semibold text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-gray-200 px-2 py-1 text-[11px] text-gray-700 dark:border-gray-800 dark:text-gray-200">
              {children}
            </td>
          ),
          img: ({ src, alt }) => (
            <img
              src={src || ""}
              alt={alt || "Preview"}
              className="mt-2 max-h-64 w-full rounded-lg border border-gray-200 object-cover dark:border-gray-800"
            />
          ),
          p: ({ children }) => (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5 text-sm">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5 text-sm">{children}</ol>
          ),
        }}
      >
        {content}
      </ReactMarkdown>

      {images.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {images.map((url, idx) => (
            <img
              key={`${url}-${idx}`}
              src={url}
              alt="Lampiran gambar"
              className="max-h-64 w-full rounded-lg border border-gray-200 object-cover dark:border-gray-800"
              loading="lazy"
            />
          ))}
        </div>
      )}

      {links.length > 0 && (
        <div className="space-y-2">
          {links.map((url, idx) => (
            <LinkPreview key={`${url}-${idx}`} url={url} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TypingIndicator({ className = "" }: { className?: string }) {
  return (
    <div className={`flex justify-start ${className}`}>
      <div className="rounded-2xl bg-gray-100 px-4 py-3 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            MALIKA sedang mengetik
          </span>
          <span className="flex gap-1">
            <span className="h-2 w-2 animate-bounce rounded-full bg-brand-500 [animation-delay:-0.3s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-brand-500 [animation-delay:-0.15s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-brand-500" />
          </span>
        </div>
      </div>
    </div>
  );
}

export function StreamingText({
  content,
  isComplete = false,
}: {
  content: string;
  isComplete?: boolean;
}) {
  const [displayedContent, setDisplayedContent] = useState("");
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    setDisplayedContent(content);
  }, [content]);

  // Blinking cursor effect when streaming
  useEffect(() => {
    if (isComplete) {
      setCursorVisible(false);
      return;
    }

    const interval = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 500);

    return () => clearInterval(interval);
  }, [isComplete]);

  return (
    <span>
      {displayedContent}
      {!isComplete && cursorVisible && (
        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-brand-500" />
      )}
    </span>
  );
}

// ============================================================================
// Chat Input
// ============================================================================

export interface ChatInputRef {
  focus: () => void;
  clear: () => void;
}

export const ChatInput = forwardRef<
  ChatInputRef,
  {
    onSend: (text: string) => void;
    disabled?: boolean;
    placeholder?: string;
    mentionItems?: string[];
    className?: string;
  }
>(function ChatInput(
  { onSend, disabled = false, placeholder, mentionItems = [], className = "" },
  ref
) {
  const [value, setValue] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    clear: () => setValue(""),
  }));

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleVoiceToggle = () => {
    if (!recognitionRef.current || disabled) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }
    setIsListening(true);
    recognitionRef.current.start();
  };

  const applyMention = (name: string) => {
    setValue((prev) => prev.replace(/@([^\s@]*)$/, `@${name} `));
    setMentionQuery(null);
    textareaRef.current?.focus();
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [value]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognitionApi =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition;

    if (!SpeechRecognitionApi) return;
    const recognition = new SpeechRecognitionApi();
    recognition.lang = "id-ID";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0]?.transcript || "";
      }
      if (transcript) {
        setValue((prev) => (prev ? `${prev} ${transcript}`.trim() : transcript.trim()));
      }
    };

    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    const match = value.match(/@([^\s@]*)$/);
    if (!match) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(match[1] ?? "");
  }, [value]);

  const filteredMentions = useMemo(() => {
    if (mentionItems.length === 0) return [];
    if (mentionQuery === null) return [];
    const q = mentionQuery.trim().toLowerCase();
    if (!q) return mentionItems.slice(0, 6);
    return mentionItems.filter((item) => item.toLowerCase().includes(q)).slice(0, 6);
  }, [mentionItems, mentionQuery]);

  return (
    <div
      className={`border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900 ${className}`}
    >
      <div className="mx-auto flex max-w-3xl items-end gap-3">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={placeholder || "Tulis pertanyaan..."}
            rows={1}
            className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          {filteredMentions.length > 0 && (
            <div className="absolute bottom-12 left-0 right-0 z-10 max-h-48 overflow-auto rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900">
              <p className="px-2 pb-1 text-[11px] font-medium text-gray-400">
                Pilih datasource
              </p>
              <ul className="space-y-1">
                {filteredMentions.map((item) => (
                  <li key={item}>
                    <button
                      type="button"
                      onClick={() => applyMention(item)}
                      className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      @{item}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleVoiceToggle}
          disabled={disabled || !recognitionRef.current}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-50 ${
            isListening
              ? "border-brand-500 bg-brand-50 text-brand-600"
              : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          }`}
          aria-label={isListening ? "Matikan input suara" : "Aktifkan input suara"}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 1v10m4-4a4 4 0 10-8 0v3a4 4 0 108 0V7zM5 10a7 7 0 0014 0M12 21v2"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
        </button>
      </div>
    </div>
  );
});

// ============================================================================
// Quick Replies
// ============================================================================

export function QuickReplies({
  items,
  onSelect,
  disabled = false,
  className = "",
}: {
  items: { label: string; value?: string }[];
  onSelect: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  if (!items.length) return null;

  return (
    <div className={`px-4 py-2 ${className}`}>
      <div className="mx-auto flex max-w-3xl flex-wrap gap-2">
        {items.map((item, idx) => (
          <button
            key={`${item.label}_${idx}`}
            type="button"
            onClick={() => onSelect(item.value || item.label)}
            disabled={disabled}
            className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:border-brand-500 hover:bg-brand-50 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-brand-500 dark:hover:bg-brand-950 dark:hover:text-brand-400"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Welcome Screen
// ============================================================================

export function WelcomeScreen({
  title = "Halo! 👋",
  subtitle = "Ada yang bisa dibantu?",
  suggestions = [],
  onSuggestionClick,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  suggestions?: string[];
  onSuggestionClick?: (text: string) => void;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-1 flex-col items-center justify-center px-4 py-8 ${className}`}
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900/30">
        <svg
          className="h-8 w-8 text-brand-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
      </div>
      <h2 className="mb-2 text-xl font-semibold text-gray-800 dark:text-white">
        {title}
      </h2>
      <p className="mb-6 text-center text-sm text-gray-500 dark:text-gray-400">
        {subtitle}
      </p>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {suggestions.map((s, idx) => (
            <button
              key={`${s}_${idx}`}
              type="button"
              onClick={() => onSuggestionClick?.(s)}
              className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition hover:border-brand-500 hover:bg-brand-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-brand-500 dark:hover:bg-brand-950"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Error Display
// ============================================================================

export function ChatError({
  message,
  onRetry,
  className = "",
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={`mx-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/30 ${className}`}
    >
      <div className="flex items-start gap-3">
        <svg
          className="mt-0.5 h-5 w-5 shrink-0 text-red-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <div className="flex-1">
          <p className="text-sm text-red-700 dark:text-red-300">{message}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              Coba lagi
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

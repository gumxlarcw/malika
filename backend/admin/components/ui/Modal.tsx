"use client";

import React, { useEffect, useCallback, useRef } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "@/hooks";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

export type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: ModalSize;
  showCloseButton?: boolean;
  closeOnOverlayClick?: boolean;
  closeOnEsc?: boolean;
  footer?: React.ReactNode;
  className?: string;
};

const sizeClasses: Record<ModalSize, string> = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
  full: "max-w-[95vw]",
};

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = "lg",
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEsc = true,
  footer,
  className = "",
}: ModalProps) {
  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (closeOnEsc && e.key === "Escape") {
        onClose();
      }
    },
    [closeOnEsc, onClose]
  );

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleEsc);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleEsc]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={closeOnOverlayClick ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "modal-title" : undefined}
        className={`bg-background rounded-xl shadow-xl w-full ${sizeClasses[size]} max-h-[90vh] flex flex-col m-4 ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
            {title && <h2 id="modal-title" className="text-lg font-semibold">{title}</h2>}
            {showCloseButton && (
              <button
                onClick={onClose}
                className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="p-4 border-t border-border shrink-0">{footer}</div>
        )}
      </div>
    </div>
  );
}

// Convenience wrapper for simple confirm dialogs
export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = "Konfirmasi",
  message,
  confirmLabel = "Ya",
  cancelLabel = "Batal",
  confirmVariant = "danger",
  loading = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "danger" | "primary";
  loading?: boolean;
}) {
  const confirmClass =
    confirmVariant === "danger"
      ? "bg-red-600 hover:bg-red-700 text-white"
      : "bg-primary hover:bg-primary/90 text-primary-foreground";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 rounded-md transition-colors disabled:opacity-50 ${confirmClass}`}
          >
            {loading ? "Loading..." : confirmLabel}
          </button>
        </div>
      }
    >
      <p className="text-muted-foreground">{message}</p>
    </Modal>
  );
}

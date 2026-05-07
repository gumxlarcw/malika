'use client';

import React from 'react';
import { Modal } from '@/components/ui/modal';
import { CloseIcon } from '@/components/chat/icons';

interface ChatShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Keyboard shortcuts help modal.
 * Extracted from ChatPageClient for readability.
 */
export default function ChatShortcutsModal({ isOpen, onClose }: ChatShortcutsModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-md">
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Pintasan Keyboard</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
            <span className="text-sm text-gray-700 dark:text-gray-300">Chat baru</span>
            <div className="flex items-center gap-1">
              <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono">Ctrl</kbd>
              <span className="text-gray-400">+</span>
              <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono">N</kbd>
            </div>
          </div>

          <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
            <span className="text-sm text-gray-700 dark:text-gray-300">Fokus input pesan</span>
            <div className="flex items-center gap-1">
              <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono">Ctrl</kbd>
              <span className="text-gray-400">+</span>
              <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono">K</kbd>
            </div>
          </div>

          <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
            <span className="text-sm text-gray-700 dark:text-gray-300">Batalkan rekaman suara</span>
            <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono">Esc</kbd>
          </div>

          <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
            <span className="text-sm text-gray-700 dark:text-gray-300">Navigasi riwayat chat</span>
            <div className="flex items-center gap-1">
              <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono">Alt</kbd>
              <span className="text-gray-400">+</span>
              <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono">↑↓</kbd>
            </div>
          </div>

          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-gray-700 dark:text-gray-300">Tampilkan bantuan ini</span>
            <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono">?</kbd>
          </div>
        </div>

        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400 text-center">
          Tekan <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">Esc</kbd> untuk menutup
        </p>
      </div>
    </Modal>
  );
}

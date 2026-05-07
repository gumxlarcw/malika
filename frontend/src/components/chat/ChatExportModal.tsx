'use client';

import React from 'react';
import { Modal } from '@/components/ui/modal';
import { CloseIcon, CheckIcon, CopyIcon, DownloadIcon } from '@/components/chat/icons';

interface ChatExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  jsonData: string;
  filename: string;
  copySuccess: boolean;
  onCopy: () => void;
  onDownload: () => void;
}

/**
 * Export JSON modal for chat conversations.
 * Extracted from ChatPageClient for readability.
 */
export default function ChatExportModal({
  isOpen,
  onClose,
  jsonData,
  filename,
  copySuccess,
  onCopy,
  onDownload,
}: ChatExportModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-4xl">
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Export JSON</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {copySuccess ? (
              <>
                <CheckIcon className="h-4 w-4 text-green-500" />
                Copied!
              </>
            ) : (
              <>
                <CopyIcon />
                Copy to Clipboard
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-700"
          >
            <DownloadIcon />
            Download
          </button>
        </div>

        {/* Filename */}
        <div className="mb-3 text-xs text-gray-500 dark:text-gray-400">
          Filename: <span className="font-mono">{filename}</span>
        </div>

        {/* JSON Preview */}
        <div className="max-h-[60vh] overflow-auto rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-900">
          <pre className="p-4 text-xs text-gray-800 dark:text-gray-200">
            <code>{jsonData}</code>
          </pre>
        </div>
      </div>
    </Modal>
  );
}

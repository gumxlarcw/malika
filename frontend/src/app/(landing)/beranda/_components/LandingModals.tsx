"use client";

import React, { useCallback, useEffect, useId, useRef } from "react";
import { cn } from "@/lib/utils";
import { getNotifItems, type Copy, type Lang } from "../_lib/copy";
import { PEOPLE } from "../_lib/people";
import {
  BORDER,
  BRAND_BORDER,
  BRAND_TEXT,
  SURFACE,
  SURFACE_BRAND_2,
  TEXT,
  TEXT_3,
  TEXT_4,
} from "../_lib/ui";

export type ModalKind = "reservasi" | "masuk" | "notif" | "petugas";

type Props = {
  t: Copy;
  lang: Lang;
  modal: ModalKind | null;
  petugas: number;
  onClose: () => void;
  onOpenReservasi: () => void;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Dialog shell for the four consultation dialogs: a bottom sheet on mobile and a
 * centred card on desktop, as drawn in the design.
 *
 * The repo's `components/ui/modal` is always centred with its own chrome, so it
 * can't express the bottom-sheet form; this shell adds the focus trap and focus
 * restore that a modal dialog needs on top of Escape and scroll-lock.
 */
function ModalShell({
  labelledBy,
  wide,
  onClose,
  closeLabel,
  children,
}: {
  labelledBy: string;
  wide?: boolean;
  onClose: () => void;
  closeLabel: string;
  children: React.ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    const sheet = sheetRef.current;
    sheet?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !sheet) return;
      const items = Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center p-0 md:items-center md:p-6">
      <button
        type="button"
        aria-label={closeLabel}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-gray-900/55 backdrop-blur-[2px]"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          "landing-rise relative z-[1] max-h-[88vh] w-full overflow-y-auto rounded-t-[20px] border px-[18px] pb-[26px] pt-[22px] shadow-theme-xl md:max-h-[86vh] md:rounded-[20px] md:px-7 md:pb-[26px] md:pt-7",
          wide ? "md:max-w-[620px]" : "md:max-w-[460px]",
          BORDER,
          SURFACE
        )}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className={cn(
            "absolute right-[18px] top-[18px] inline-flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-full border transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800",
            BORDER,
            SURFACE,
            TEXT_4
          )}
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        {children}
      </div>
    </div>
  );
}

/** Shared field styling for the two forms. */
function Field({
  label,
  placeholder,
  type = "text",
}: {
  label: string;
  placeholder: string;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={cn("text-xs font-medium leading-[18px]", TEXT_3)}>{label}</span>
      <input
        type={type}
        placeholder={placeholder}
        className={cn(
          "box-border h-11 rounded-[10px] border px-3.5 text-sm outline-none focus:border-brand-400",
          BORDER,
          SURFACE,
          TEXT
        )}
      />
    </label>
  );
}

export default function LandingModals({
  t,
  lang,
  modal,
  petugas,
  onClose,
  onOpenReservasi,
}: Props) {
  const titleId = useId();
  const handleClose = useCallback(() => onClose(), [onClose]);

  if (!modal) return null;

  const heading = cn("text-xl font-semibold leading-7", TEXT);

  if (modal === "reservasi") {
    return (
      <ModalShell labelledBy={titleId} wide onClose={handleClose} closeLabel={t.tClose}>
        <div id={titleId} className={heading}>
          {t.tMRsvH}
        </div>
        <p className={cn("mt-1.5 text-[13px] leading-5", TEXT_4)}>{t.tMRsvSub}</p>

        <div className="mt-5 grid gap-3.5 md:grid-cols-2">
          <Field label={t.tMFieldWho} placeholder={t.tMFieldWhoHint} />
          <Field label={t.tMFieldTopic} placeholder={t.tMFieldTopicHint} />
          <Field label={t.tMFieldDate} placeholder={t.tMFieldDateHint} />
          <Field label={t.tMFieldTime} placeholder={t.tMFieldTimeHint} />
        </div>

        <div className="mt-4">
          <div className={cn("text-xs font-medium leading-[18px]", TEXT_3)}>{t.tMMode}</div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={cn(
                "h-11 flex-1 cursor-pointer rounded-[10px] border text-[13px] font-semibold",
                BRAND_BORDER,
                SURFACE_BRAND_2,
                BRAND_TEXT
              )}
            >
              {t.tMModeZoom}
            </button>
            <button
              type="button"
              className={cn(
                "h-11 flex-1 cursor-pointer rounded-[10px] border text-[13px] font-semibold hover:border-brand-200 dark:hover:border-brand-500/45",
                BORDER,
                SURFACE,
                TEXT
              )}
            >
              {t.tMModeOffice}
            </button>
          </div>
        </div>

        <div className="mt-[22px] flex items-center justify-between gap-4">
          <span className={cn("text-xs leading-[18px]", TEXT_4)}>{t.tMRsvNote}</span>
          <button
            type="button"
            className="h-11 shrink-0 cursor-pointer whitespace-nowrap rounded-[10px] border-0 bg-brand-500 px-[22px] text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-600"
          >
            {t.tMRsvSend}
          </button>
        </div>
      </ModalShell>
    );
  }

  if (modal === "masuk") {
    return (
      <ModalShell labelledBy={titleId} onClose={handleClose} closeLabel={t.tClose}>
        <div id={titleId} className={heading}>
          {t.tMAuthH}
        </div>
        <p className={cn("mt-1.5 text-[13px] leading-5", TEXT_4)}>{t.tMAuthSub}</p>
        <div className="mt-5 flex flex-col gap-3.5">
          <Field label={t.tMAuthEmail} placeholder="nama@email.com" type="email" />
          <Field label={t.tMAuthOrg} placeholder={t.tMAuthOrgHint} />
        </div>
        <button
          type="button"
          className="mt-5 h-[46px] w-full cursor-pointer rounded-[10px] border-0 bg-brand-500 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-brand-600"
        >
          {t.tMAuthSend}
        </button>
        <p className={cn("mt-3 text-center text-xs leading-[18px]", TEXT_4)}>{t.tMAuthNote}</p>
      </ModalShell>
    );
  }

  if (modal === "notif") {
    return (
      <ModalShell labelledBy={titleId} onClose={handleClose} closeLabel={t.tClose}>
        <div id={titleId} className={heading}>
          {t.tMNotifH}
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {getNotifItems(lang).map((item, i) => (
            <div
              key={item.title}
              className={cn("flex gap-3 rounded-xl border p-3.5", BORDER, SURFACE)}
            >
              <span
                className={cn(
                  "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                  i === 0 ? "bg-orange-500" : "bg-brand-200"
                )}
              />
              <span className="min-w-0">
                <span className={cn("block text-sm font-medium leading-5", TEXT)}>{item.title}</span>
                <span className={cn("mt-0.5 block text-xs leading-[18px]", TEXT_4)}>{item.time}</span>
              </span>
            </div>
          ))}
        </div>
      </ModalShell>
    );
  }

  const person = PEOPLE[petugas] ?? PEOPLE[0];
  return (
    <ModalShell labelledBy={titleId} onClose={handleClose} closeLabel={t.tClose}>
      <div className="flex items-start gap-4.5">
        <span
          className={cn(
            "inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-base font-semibold",
            SURFACE_BRAND_2,
            BRAND_TEXT
          )}
        >
          {person.init}
        </span>
        <span className="min-w-0">
          <span id={titleId} className={cn("block text-[19px] font-semibold leading-[26px]", TEXT)}>
            {person.nama}
          </span>
          <span className={cn("mt-[3px] block text-[13px] leading-5", TEXT_4)}>{person.jabatan}</span>
        </span>
      </div>
      <div className="mt-4.5 flex flex-wrap gap-2">
        {person.chips.map((chip) => (
          <span
            key={chip}
            className={cn(
              "rounded-full border px-3 py-[5px] text-xs font-medium leading-[18px]",
              BRAND_BORDER,
              SURFACE_BRAND_2,
              BRAND_TEXT
            )}
          >
            {chip}
          </span>
        ))}
      </div>
      <p className={cn("mt-4 text-[13px] leading-[21px]", TEXT_3)}>{t.tMPetugasNote}</p>
      <button
        type="button"
        onClick={onOpenReservasi}
        className="mt-5 h-[46px] w-full cursor-pointer rounded-[10px] border-0 bg-brand-500 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-brand-600"
      >
        {t.tMPetugasCta}
      </button>
    </ModalShell>
  );
}

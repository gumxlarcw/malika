"use client";
import { BellIcon, BookIcon, DocsIcon, PieChartIcon } from "@/icons";
import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";
import { Dropdown } from "../ui/dropdown/Dropdown";
import { DropdownItem } from "../ui/dropdown/DropdownItem";
import type { NotificationItem } from "@/lib/notifications.data";
import {
  clearAppBadgeSafe,
  ensureLastSeenNotificationAtInitialized,
  getLastSeenNotificationAt,
  maxNotificationCreatedAt,
  setAppBadgeSafe,
  setLastSeenNotificationAt,
  unreadCountByTime,
} from "@/lib/notifications.unread";

export default function NotificationDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);

  function toggleDropdown() {
    setIsOpen(!isOpen);
  }

  function closeDropdown() {
    setIsOpen(false);
  }

  const handleClick = () => {
    toggleDropdown();
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=20", { cache: "no-store" });
      const data = (await res.json()) as { items?: NotificationItem[] };
      const nextItems = Array.isArray(data.items) ? data.items : [];
      setItems(nextItems);

      // If baseline is missing (e.g. first install), set it to now so backfill doesn't create badges.
      // New notifications created after this moment will still show as unread.
      const lastSeenAt = getLastSeenNotificationAt() || ensureLastSeenNotificationAtInitialized(new Date());
      const nextUnread = unreadCountByTime(nextItems, lastSeenAt);
      setUnread(nextUnread);
      if (nextUnread > 0) await setAppBadgeSafe(nextUnread);
      else await clearAppBadgeSafe();
    } catch {
      setItems([]);
      setUnread(0);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isOpen) return;
    load();
  }, [isOpen, load]);

  useEffect(() => {
    if (!isOpen) return;
    const maxAt = maxNotificationCreatedAt(items);
    if (maxAt) setLastSeenNotificationAt(maxAt);
    setUnread(0);
    clearAppBadgeSafe();
  }, [isOpen, items]);

  return (
    <div className="relative">
      <button
        className="relative dropdown-toggle flex items-center justify-center text-gray-500 transition-colors bg-white border border-gray-200 rounded-full hover:text-gray-700 h-11 w-11 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
        onClick={handleClick}
      >
        <span
          className={`absolute right-0 top-0.5 z-10 h-2 w-2 rounded-full bg-orange-400 ${
            unread > 0 ? "flex" : "hidden"
          }`}
        >
          <span className="absolute inline-flex w-full h-full bg-orange-400 rounded-full opacity-75 animate-ping"></span>
        </span>
        <svg
          className="fill-current"
          width="20"
          height="20"
          viewBox="0 0 20 20"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M10.75 2.29248C10.75 1.87827 10.4143 1.54248 10 1.54248C9.58583 1.54248 9.25004 1.87827 9.25004 2.29248V2.83613C6.08266 3.20733 3.62504 5.9004 3.62504 9.16748V14.4591H3.33337C2.91916 14.4591 2.58337 14.7949 2.58337 15.2091C2.58337 15.6234 2.91916 15.9591 3.33337 15.9591H4.37504H15.625H16.6667C17.0809 15.9591 17.4167 15.6234 17.4167 15.2091C17.4167 14.7949 17.0809 14.4591 16.6667 14.4591H16.375V9.16748C16.375 5.9004 13.9174 3.20733 10.75 2.83613V2.29248ZM14.875 14.4591V9.16748C14.875 6.47509 12.6924 4.29248 10 4.29248C7.30765 4.29248 5.12504 6.47509 5.12504 9.16748V14.4591H14.875ZM8.00004 17.7085C8.00004 18.1228 8.33583 18.4585 8.75004 18.4585H11.25C11.6643 18.4585 12 18.1228 12 17.7085C12 17.2943 11.6643 16.9585 11.25 16.9585H8.75004C8.33583 16.9585 8.00004 17.2943 8.00004 17.7085Z"
            fill="currentColor"
          />
        </svg>
      </button>
      <Dropdown
        isOpen={isOpen}
        onClose={closeDropdown}
        className="absolute -right-[240px] mt-[17px] flex h-[480px] w-[350px] flex-col rounded-2xl border border-gray-200 bg-white p-3 shadow-theme-lg dark:border-gray-800 dark:bg-gray-dark sm:w-[361px] lg:right-0"
      >
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-100 dark:border-gray-700">
          <h5 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
            Notification
          </h5>
          <button
            onClick={toggleDropdown}
            className="text-gray-500 transition dropdown-toggle dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <svg
              className="fill-current"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M6.21967 7.28131C5.92678 6.98841 5.92678 6.51354 6.21967 6.22065C6.51256 5.92775 6.98744 5.92775 7.28033 6.22065L11.999 10.9393L16.7176 6.22078C17.0105 5.92789 17.4854 5.92788 17.7782 6.22078C18.0711 6.51367 18.0711 6.98855 17.7782 7.28144L13.0597 12L17.7782 16.7186C18.0711 17.0115 18.0711 17.4863 17.7782 17.7792C17.4854 18.0721 17.0105 18.0721 16.7176 17.7792L11.999 13.0607L7.28033 17.7794C6.98744 18.0722 6.51256 18.0722 6.21967 17.7794C5.92678 17.4865 5.92678 17.0116 6.21967 16.7187L10.9384 12L6.21967 7.28131Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
        <ul className="flex flex-col h-auto overflow-y-auto custom-scrollbar">
          {items.length === 0 ? (
            <li className="px-4.5 py-3 text-theme-sm text-gray-500 dark:text-gray-400">
              Belum ada notifikasi.
            </li>
          ) : null}
          {items.map((n) => (
            <li key={n.id}>
              <DropdownItem
                onItemClick={closeDropdown}
                tag={n.link ? "a" : "button"}
                href={n.link || undefined}
                className="flex gap-3 rounded-lg border-b border-gray-100 p-3 px-4.5 py-3 hover:bg-gray-100 dark:border-gray-800 dark:hover:bg-white/5"
              >
                <span className="relative block w-full h-11 rounded-full z-1 max-w-11">
                  <span
                    className={
                      "flex h-11 w-11 items-center justify-center rounded-full p-1.5 " +
                      (n.category === "Publikasi"
                        ? "bg-success-50 text-success-500 dark:bg-success-500/[0.12] dark:text-success-400"
                        : n.category === "Berita Resmi Statistik"
                          ? "bg-warning-50 text-warning-500 dark:bg-warning-500/[0.12] dark:text-warning-400"
                          : n.category === "Data Statistik"
                            ? "bg-brand-50 text-brand-500 dark:bg-brand-500/[0.12] dark:text-brand-400"
                            : "bg-gray-100 text-gray-700 dark:bg-white/[0.05] dark:text-gray-200")
                    }
                  >
                    {n.category === "Publikasi" ? (
                      <BookIcon className="block h-8 w-8 overflow-visible flex-shrink-0" />
                    ) : n.category === "Berita Resmi Statistik" ? (
                      <DocsIcon className="block h-8 w-8 overflow-visible flex-shrink-0" />
                    ) : n.category === "Data Statistik" ? (
                      <PieChartIcon className="block h-8 w-8 overflow-visible flex-shrink-0" />
                    ) : (
                      <BellIcon className="block h-8 w-8 overflow-visible flex-shrink-0" />
                    )}
                  </span>
                  <span
                    className={`absolute bottom-0 right-0 z-10 h-2.5 w-full max-w-2.5 rounded-full border-[1.5px] border-white dark:border-gray-900 ${n.statusDotClass}`}
                  ></span>
                </span>

                <span className="block">
                  <span className="mb-1.5 space-x-1 block text-theme-sm text-gray-500 dark:text-gray-400">
                    <span className="font-medium text-gray-800 dark:text-white/90">
                      {n.userName}
                    </span>
                    <span>{n.actionText}</span>
                  </span>

                  <span className="flex items-center gap-2 text-gray-500 text-theme-xs dark:text-gray-400">
                    <span>{n.category}</span>
                    <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
                    <span>{n.timeAgo}</span>
                  </span>
                </span>
              </DropdownItem>
            </li>
          ))}
        </ul>
        <Link
          href="/notifications"
          className="block px-4 py-2 mt-3 text-sm font-medium text-center text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          View All Notifications
        </Link>
      </Dropdown>
    </div>
  );
}

"use client";

import { useEffect } from "react";

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
};

// 右侧抽屉复用打开/关闭、遮罩、Esc 关闭和滚动锁定，避免每个业务面板重复处理。
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
}: DrawerProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, open]);

  return (
    <div
      aria-hidden={!open}
      className={`fixed inset-0 z-50 ${
        open ? "visible opacity-100" : "invisible opacity-0"
      } transition-opacity duration-200`}
      inert={!open}
    >
      <div
        className="absolute inset-0 bg-zinc-950/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <section
        aria-modal={open}
        className={`absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-zinc-50 shadow-2xl transition-transform duration-300 ease-out dark:bg-black ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
      >
        <header className="flex items-start justify-between gap-4 border-b border-black/5 px-6 py-5 dark:border-white/10">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            <span aria-hidden>×</span>
            <span className="sr-only">关闭抽屉</span>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </section>
    </div>
  );
}

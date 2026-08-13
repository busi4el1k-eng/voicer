"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/components/LanguageProvider";

/**
 * App-styled replacement for the native `confirm()` / `alert()` dialogs.
 *
 * Usage:
 *   const { dialog, confirm, alert } = useAppDialog();
 *   // render {dialog} once in the tree, then:
 *   if (await confirm({ title: "Delete?", message: "…", tone: "danger" })) { … }
 *   await alert({ title: "Failed", message: err, tone: "danger" });
 */

type DialogTone = "default" | "danger";

export type DialogOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
  icon?: string; // emoji shown above the title
};

type DialogState = DialogOptions & {
  open: boolean;
  kind: "confirm" | "alert";
  resolve?: (value: boolean) => void;
};

export function useAppDialog() {
  const [state, setState] = useState<DialogState>({
    open: false,
    kind: "confirm",
    title: "",
  });

  const settle = useCallback((value: boolean) => {
    setState((s) => {
      s.resolve?.(value);
      return { ...s, open: false, resolve: undefined };
    });
  }, []);

  const confirm = useCallback(
    (opts: DialogOptions) =>
      new Promise<boolean>((resolve) =>
        setState({ open: true, kind: "confirm", ...opts, resolve }),
      ),
    [],
  );

  const alert = useCallback(
    (opts: DialogOptions) =>
      new Promise<boolean>((resolve) =>
        setState({ open: true, kind: "alert", ...opts, resolve }),
      ),
    [],
  );

  const dialog = <AppDialog state={state} onSettle={settle} />;

  return { dialog, confirm, alert };
}

function AppDialog({
  state,
  onSettle,
}: {
  state: DialogState;
  onSettle: (value: boolean) => void;
}) {
  const { t } = useI18n();
  // Esc cancels, Enter confirms — only while open.
  useEffect(() => {
    if (!state.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSettle(false);
      if (e.key === "Enter") onSettle(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.open, onSettle]);

  if (!state.open) return null;

  const danger = state.tone === "danger";
  const icon = state.icon ?? (danger ? "⚠️" : "💬");

  return (
    <div
      className="g-modal-overlay"
      style={{ zIndex: 70 }}
      onClick={() => onSettle(false)}
    >
      <div
        className="g-modal"
        style={{ maxWidth: 380, gap: 12 }}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        <div style={{ fontSize: 40, lineHeight: 1 }} aria-hidden>
          {icon}
        </div>
        <div className="g-modal-title" style={{ fontSize: 20 }}>
          {state.title}
        </div>
        {state.message && <div className="g-modal-sub">{state.message}</div>}

        <div className="flex w-full gap-2 pt-2">
          {state.kind === "confirm" && (
            <button
              className="g-btn g-btn-ghost flex-1"
              style={{ height: 46, fontSize: 15 }}
              onClick={() => onSettle(false)}
            >
              {state.cancelLabel ?? t("common.cancel")}
            </button>
          )}
          <button
            className={`g-btn flex-1 ${danger ? "g-btn-danger" : "g-btn-start"}`}
            style={{ height: 46, fontSize: 15 }}
            autoFocus
            onClick={() => onSettle(true)}
          >
            {state.confirmLabel ?? (state.kind === "alert" ? t("common.ok") : t("common.confirm"))}
          </button>
        </div>
      </div>
    </div>
  );
}

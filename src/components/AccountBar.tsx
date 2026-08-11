"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth, useUser, useClerk } from "@clerk/nextjs";
import { isClerkConfigured } from "@/lib/clerk";
import { useClerkFailed } from "@/components/ClerkResilientProvider";
import { useI18n } from "@/components/LanguageProvider";

// Settings dialog: change the username shown across the app, and — for members
// who signed up with a password — change that password via Clerk.
function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { user } = useUser();
  const current =
    user?.firstName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ||
    "";
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const save = async () => {
    const value = name.trim();
    if (!value) return setErr(t("settings.enterUsername"));
    setBusy(true);
    setErr("");
    try {
      // The dashboard reads the name from our DB, so that's the source of truth.
      const r = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: value }),
      });
      if (!r.ok) throw new Error((await r.json()).error || t("settings.couldntSave"));
      // Mirror it into Clerk too so the menu/name updates live (best-effort).
      try {
        await user?.update({ firstName: value });
      } catch {
        /* Clerk may reject the field; the DB name still applies */
      }
      setDone(true);
      setTimeout(onClose, 700);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("settings.couldntSave"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/70" onClick={onClose} />
      <div
        className="g-panel relative z-10 w-full max-w-sm"
        style={{ backgroundColor: "#251c5c" }}
      >
        <h3 className="mb-3 font-display text-[20px] font-black uppercase tracking-[0.04em] text-cream">
          {t("settings.title")}
        </h3>
        <label className="mb-1 block font-display text-[11px] font-bold uppercase tracking-[0.08em] text-cream/45">
          {t("settings.username")}
        </label>
        <input
          value={name}
          autoFocus
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") onClose();
          }}
          placeholder={t("settings.usernamePh")}
          className="w-full rounded-[10px] bg-violet-deep/60 px-4 py-3 text-[15px] text-cream shadow-[inset_0_0_0_2px_rgba(137,82,220,0.4)] placeholder:text-cream/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint"
        />
        {err && <p className="mt-2 text-[13px] text-magenta">{err}</p>}
        {done && <p className="mt-2 text-[13px] text-mint">{t("common.saved")}</p>}
        <div className="mt-5 flex gap-2">
          <button
            onClick={save}
            disabled={busy}
            className="g-btn g-btn-primary h-11 flex-1 text-[14px] disabled:opacity-60"
          >
            {busy ? t("common.saving") : t("common.save")}
          </button>
          <button onClick={onClose} className="g-btn g-btn-ghost h-11 flex-1 text-[14px]">
            {t("common.cancel")}
          </button>
        </div>

        {/* Change (or, for OAuth-only accounts, set) the password via Clerk. */}
        <ChangePassword />
      </div>
    </div>
  );
}

// Collapsible "Change password" section that talks to Clerk directly. Accounts
// that already have a password must confirm the current one; OAuth-only accounts
// (no password yet) just set a new one.
function ChangePassword() {
  const { t } = useI18n();
  const { user } = useUser();
  const hasPassword = !!user?.passwordEnabled;
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const save = async () => {
    if (!user) return;
    if (newPassword.length < 8) return setErr(t("settings.use8"));
    setBusy(true);
    setErr("");
    setDone(false);
    try {
      // currentPassword only matters when one already exists; Clerk ignores it
      // for accounts setting a password for the first time.
      await user.updatePassword({
        ...(hasPassword ? { currentPassword } : {}),
        newPassword,
        signOutOfOtherSessions: true,
      });
      setDone(true);
      setCurrentPassword("");
      setNewPassword("");
    } catch (e: unknown) {
      const clerkErr = e as { errors?: { longMessage?: string; message?: string }[] };
      setErr(
        clerkErr?.errors?.[0]?.longMessage ||
          clerkErr?.errors?.[0]?.message ||
          t("settings.couldntChange"),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 w-full text-left font-display text-[13px] font-bold uppercase tracking-[0.06em] text-mint hover:text-cream"
      >
        {hasPassword ? t("settings.changePassword") : t("settings.setPassword")}
      </button>
    );
  }

  return (
    <div className="mt-5 border-t border-cream/10 pt-4">
      {hasPassword && (
        <>
          <label className="mb-1 block font-display text-[11px] font-bold uppercase tracking-[0.08em] text-cream/45">
            {t("settings.currentPassword")}
          </label>
          <input
            type="password"
            value={currentPassword}
            autoFocus
            autoComplete="current-password"
            onChange={(e) => setCurrentPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
            placeholder="••••••••"
            className="mb-3 w-full rounded-[10px] bg-violet-deep/60 px-4 py-3 text-[15px] text-cream shadow-[inset_0_0_0_2px_rgba(137,82,220,0.4)] placeholder:text-cream/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint"
          />
        </>
      )}
      <label className="mb-1 block font-display text-[11px] font-bold uppercase tracking-[0.08em] text-cream/45">
        {t("settings.newPassword")}
      </label>
      <input
        type="password"
        value={newPassword}
        autoComplete="new-password"
        onChange={(e) => setNewPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
        }}
        placeholder={t("settings.atLeast8")}
        className="w-full rounded-[10px] bg-violet-deep/60 px-4 py-3 text-[15px] text-cream shadow-[inset_0_0_0_2px_rgba(137,82,220,0.4)] placeholder:text-cream/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint"
      />
      {err && <p className="mt-2 text-[13px] text-magenta">{err}</p>}
      {done && <p className="mt-2 text-[13px] text-mint">{t("settings.passwordUpdated")}</p>}
      <div className="mt-4 flex gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="g-btn g-btn-primary h-11 flex-1 text-[14px] disabled:opacity-60"
        >
          {busy ? t("settings.updating") : t("settings.updatePassword")}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="g-btn g-btn-ghost h-11 flex-1 text-[14px]"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

// Our own account menu, replacing Clerk's <UserButton/>: a 3-dots button that
// opens a small app-styled dropdown. Signed-in members get Settings and a
// working Sign out; guests get a single Log in redirect.
function AccountMenu({ signedIn }: { signedIn: boolean }) {
  const { t } = useI18n();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const name =
    user?.firstName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ||
    "Player";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t("acct.menu")}
        className="grid h-9 w-9 place-items-center rounded-[12px] text-ink shadow-[inset_0_0_0_2px_#fff2c2,0_3px_0_0_#c99a1e] transition-transform active:translate-y-[2px] active:shadow-[inset_0_0_0_2px_#fff2c2,0_1px_0_0_#c99a1e]"
        style={{ background: "linear-gradient(0deg, #ffcf3f 0%, #ffe27a 100%)" }}
      >
        <span className="flex flex-col items-center gap-[3px]">
          <span className="h-[3.5px] w-[3.5px] rounded-full bg-ink" />
          <span className="h-[3.5px] w-[3.5px] rounded-full bg-ink" />
          <span className="h-[3.5px] w-[3.5px] rounded-full bg-ink" />
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-[calc(100%+8px)] z-50 w-56 overflow-hidden rounded-[12px] shadow-[0_10px_28px_rgba(0,0,0,0.45)]"
            style={{ backgroundColor: "#251c5c", boxShadow: "inset 0 0 0 2px #8952dc" }}
          >
            {signedIn ? (
              <>
                {/* Who's signed in */}
                <div className="border-b border-cream/10 px-4 py-3">
                  <div className="truncate font-display text-[14px] font-black text-cream">
                    {name}
                  </div>
                  {email && <div className="truncate text-[12px] text-cream/50">{email}</div>}
                </div>

                <button
                  onClick={() => {
                    setOpen(false);
                    setSettingsOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left font-display text-[14px] font-semibold text-cream hover:bg-violet-lift/50"
                >
                  <span aria-hidden>⚙️</span> {t("acct.settings")}
                </button>

                <button
                  onClick={() => {
                    setOpen(false);
                    void signOut({ redirectUrl: "/" });
                  }}
                  className="flex w-full items-center gap-2 border-t border-cream/10 px-4 py-3 text-left font-display text-[14px] font-semibold text-magenta hover:bg-magenta/15"
                >
                  <span aria-hidden>🚪</span> {t("acct.signOut")}
                </button>
              </>
            ) : (
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left font-display text-[14px] font-semibold text-cream hover:bg-violet-lift/50"
              >
                <span aria-hidden>🔑</span> {t("acct.login")}
              </Link>
            )}
          </div>
        </>
      )}

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

// The 3-dots account menu, for guests and members alike. Split so the hook only
// runs when a ClerkProvider is actually mounted.
function ClerkAccount() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="h-9 w-9" />;
  return <AccountMenu signedIn={!!isSignedIn} />;
}

export function AccountBar() {
  const clerkFailed = useClerkFailed();
  // Guest-only build (no Clerk) or Clerk failed to load: nothing to show here.
  if (!isClerkConfigured() || clerkFailed) return null;
  return <ClerkAccount />;
}

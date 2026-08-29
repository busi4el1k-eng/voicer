// Skins Clerk's <SignIn/> and <SignUp/> widgets into the Cinema Dub register:
// violet stage card, chunky sun-yellow primary button, cream text, Nunito/Fredoka
// type, mint accents. Kept in one place so login and signup can't drift apart.
// Tailwind v4 scans this file, so the arbitrary-value class strings below are
// emitted into the bundle like any component's classes. Typed structurally at the
// `appearance={...}` call sites (Clerk's Appearance type isn't a direct dep).
//
// Clerk ships a LIGHT base theme (dark text), so on our dark card its per-element
// colors would stay dark and unreadable. The `!` important modifier (Tailwind v4)
// forces our colors past Clerk's own element styles.
export const clerkAppearance = {
  variables: {
    colorPrimary: "#ffb42e",
    colorText: "#fff6ec",
    colorTextSecondary: "rgba(255, 246, 236, 0.65)",
    colorBackground: "#251c5c",
    colorInputBackground: "rgba(42, 8, 69, 0.6)",
    colorInputText: "#fff6ec",
    colorDanger: "#ff3d8b",
    colorSuccess: "#27e1a1",
    borderRadius: "12px",
    fontFamily: "var(--font-nunito), system-ui, sans-serif",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "shadow-none! w-full",
    card: "bg-[#251c5c]! border-2 border-[rgba(32,18,85,0.2)] rounded-2xl shadow-[inset_0_0_0_2px_#8952dc,0_12px_0_0_rgba(17,0,69,0.4)]!",

    // We render our own "Cinema Dub" header above the widget, so hide Clerk's
    // internal one (it showed a faint, dark "Sign in to Voicer" + subtitle).
    // Important, else Clerk's own display on .cl-header wins and it stays visible.
    header: "hidden!",

    socialButtonsBlockButton:
      "bg-[rgba(42,8,69,0.55)]! border-2 border-[#8952dc]! rounded-[10px] hover:bg-[rgba(42,8,69,0.8)]!",
    socialButtonsBlockButtonText: "font-display font-bold text-cream!",
    socialButtonsProviderIcon: "brightness-100",

    dividerLine: "bg-cream/15!",
    dividerText: "text-cream/45! uppercase text-[11px] tracking-[0.1em]",

    formFieldLabel:
      "font-display text-[11px] font-bold uppercase tracking-[0.08em] text-cream/70!",
    formFieldInput:
      "bg-violet-deep/60! border-2 border-[#8952dc]! text-cream! rounded-[10px] placeholder:text-cream/35 focus:border-mint!",
    formFieldInputShowPasswordButton: "text-cream/50! hover:text-cream!",

    formButtonPrimary:
      "bg-gradient-to-t! from-[#ffb42e]! to-[#ffcf63]! text-[#4a3400]! font-display font-black uppercase text-[15px] rounded-[8px] shadow-[inset_0_0_0_2px_#fff2c2,0_4px_0_0_#c8851c]! transition-transform active:translate-y-[2px] hover:opacity-95",

    identityPreviewText: "text-cream!",
    identityPreviewEditButton: "text-mint! hover:text-mint!",

    formResendCodeLink: "text-mint! hover:text-mint!",
    otpCodeFieldInput: "border-2 border-[#8952dc]! text-cream!",

    footer: "bg-transparent!",
    footerActionText: "text-cream/60!",
    footerActionLink: "text-mint! hover:text-mint! font-bold",

    // Clerk's "Secured by Clerk" / dev-mode footer badges — muted, not hidden.
    logoBox: "hidden",
    footerPagesLink: "text-cream/40! hover:text-cream/70!",
  },
};

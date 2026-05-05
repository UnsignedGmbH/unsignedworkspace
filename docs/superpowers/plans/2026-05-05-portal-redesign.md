# Customer Portal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/portal?room=…` (the page customers open via the share link) into an editorial, brand-defining experience that makes Unsigned Workspace feel like a studio instead of a generic SaaS dashboard.

**Architecture:** Single Astro page with vanilla JS. No new runtime dependencies. Self-host one new variable display font (Fraunces) to avoid generic Google-Fonts FOUT and to give typographic identity. Layout: full-bleed brand-red header strip → asymmetric oversized tool-switcher → iframe in a "vellum" frame → minimal footer. Subtle staggered fade-in on load. Brand colors and Montserrat preserved; Dancing Script demoted to one accent line; Fraunces (variable serif) added for display headlines.

**Tech Stack:** Astro 5, Tailwind CSS 4 (`@theme` tokens), Firebase RTDB compat (already wired in `BaseLayout.astro` as `window.fb`), Fraunces variable font (self-hosted from Google Fonts CSS but woff2 in `/public/fonts/`).

**Aesthetic direction:** Editorial / magazine. Asymmetric grid. Generous whitespace. Bold typographic hierarchy with numerical tool prefixes (`01 BRAND IDENTITY`). Live indicator with pulsing dot. Subtle grain overlay on body for analog texture. Custom-shaped iframe frame (not a card). No purple gradients, no pill-button stacks, no centered hero copy.

**Out of scope:** Owner-side `customer.astro`, dashboard, login. Only the customer-facing portal route.

---

## File Structure

| Path | Purpose | Action |
|---|---|---|
| `src/styles/global.css` | Add Fraunces font-face + new design tokens (`--font-display`, animations, grain) | Modify |
| `public/fonts/Fraunces[opsz,wght].woff2` | Self-hosted variable font | Create (download once) |
| `src/pages/portal.astro` | The redesigned page | Rewrite |
| `src/components/PortalLiveBadge.astro` | Reusable live indicator (header) | Create |
| `src/components/PortalToolSwitcher.astro` | Numbered tool-switcher with active oversized name | Create |
| `src/components/PortalFrame.astro` | The vellum iframe wrapper | Create |
| `src/components/PortalFooter.astro` | Minimal footer | Create |

The page composes the four small components so each component file stays under ~80 lines and one responsibility per file.

---

## Pre-flight (one-time setup)

- [ ] **Step 0a: Verify dev server is running**

Run: `/usr/bin/curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/portal?room=DEMO123`
Expected: `200`

If not running, start it: `npm run dev --prefix /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace` (in another terminal, or via Bash with `run_in_background: true`).

- [ ] **Step 0b: Confirm git is initialized**

Run: `git -C /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace status 2>&1 | head -1`
Expected: either "On branch …" or an init suggestion.

If not initialized, run:
```bash
cd /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace && git init -q && git add -A && git commit -q -m "chore: snapshot before portal redesign"
```
Without git, skip the commit steps later in this plan but DO take a backup: `cp -r src src.bak.$(date +%s)`.

---

## Task 1: Self-host Fraunces variable font

**Files:**
- Create: `public/fonts/Fraunces.woff2`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Download the variable woff2 from Google Fonts**

```bash
mkdir -p /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace/public/fonts
/usr/bin/curl -s -L -o /tmp/fraunces.css \
  -H "User-Agent: Mozilla/5.0" \
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..900&display=swap"
WOFF2_URL=$(grep -oE 'https://[^)]+\.woff2' /tmp/fraunces.css | head -1)
echo "URL: $WOFF2_URL"
/usr/bin/curl -s -L -o /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace/public/fonts/Fraunces.woff2 "$WOFF2_URL"
ls -la /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace/public/fonts/Fraunces.woff2
```
Expected: file ~40-100 KB.

- [ ] **Step 2: Add the @font-face + token to global.css**

Open `src/styles/global.css`. Add this block immediately after the `@import "tailwindcss";` line:

```css
@font-face {
  font-family: "Fraunces";
  src: url("/fonts/Fraunces.woff2") format("woff2-variations");
  font-weight: 400 900;
  font-style: normal;
  font-display: swap;
}
```

Inside the existing `@theme { … }` block, add this line at the end (before the closing brace):

```css
--font-display: "Fraunces", "Georgia", serif;
```

- [ ] **Step 3: Verify font loads in dev**

Run: `/usr/bin/curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/fonts/Fraunces.woff2`
Expected: `200`

- [ ] **Step 4: Commit**

```bash
git -C /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace add -A
git -C /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace commit -q -m "feat(portal): self-host Fraunces variable font + display token"
```

---

## Task 2: Add design tokens, grain texture, fade-in animation

**Files:**
- Modify: `src/styles/global.css`

- [ ] **Step 1: Add tokens for portal**

Inside the existing `@theme { … }` block, add these tokens before the closing brace:

```css
--color-paper: #f6f3ee;
--color-ink-warm: #1a1816;
--ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
```

- [ ] **Step 2: Add a `@layer utilities` block at the bottom of the file**

```css
@layer utilities {
  .grain-overlay::after {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 1;
    opacity: 0.06;
    mix-blend-mode: multiply;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
    background-size: 160px 160px;
  }
  .fade-up {
    animation: fadeUp 0.7s var(--ease-out-quart) both;
  }
  .pulse-dot {
    animation: pulseDot 1.6s ease-in-out infinite;
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translate3d(0, 12px, 0); }
    to   { opacity: 1; transform: translate3d(0, 0, 0); }
  }
  @keyframes pulseDot {
    0%, 100% { box-shadow: 0 0 0 0 rgba(193, 48, 48, 0.45); }
    50%      { box-shadow: 0 0 0 8px rgba(193, 48, 48, 0); }
  }
}
```

- [ ] **Step 3: Verify CSS compiles**

Run: `/usr/bin/curl -s http://localhost:4321/portal | grep -c "grain-overlay\|fade-up\|pulseDot"`
Expected: at least `1` (Tailwind 4 inlines unused utility CSS only when referenced; this only gets included once portal markup uses the classes — that happens in Task 6, so this step might still return 0. That's fine.)

- [ ] **Step 4: Commit**

```bash
git -C /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace add -A
git -C /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace commit -q -m "feat(portal): add paper/grain/animation tokens"
```

---

## Task 3: PortalLiveBadge component

**Files:**
- Create: `src/components/PortalLiveBadge.astro`

- [ ] **Step 1: Write the component**

```astro
---
interface Props {
  room: string;
}
const { room } = Astro.props;
---

<div
  class="flex items-center gap-3 text-white/95 font-medium text-[11px] tracking-[0.18em] uppercase"
>
  <span class="opacity-70">Raum</span>
  <span
    class="font-display font-semibold tracking-[0.06em] text-[15px] text-white"
    >{room}</span
  >
  <span
    aria-hidden="true"
    class="ml-2 inline-flex items-center gap-2 rounded-full border border-white/30 px-3 py-1 text-[10px] tracking-[0.22em]"
  >
    <span
      class="pulse-dot inline-block h-[7px] w-[7px] rounded-full bg-white"
    ></span>
    Live
  </span>
</div>
```

- [ ] **Step 2: Verify the page still compiles**

Run: `/usr/bin/curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/portal?room=ABC123`
Expected: `200` (component isn't used yet but no compile error).

- [ ] **Step 3: Commit**

```bash
git -C /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace add -A
git -C /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace commit -q -m "feat(portal): live badge component"
```

---

## Task 4: PortalToolSwitcher component

**Files:**
- Create: `src/components/PortalToolSwitcher.astro`

- [ ] **Step 1: Write the component**

```astro
---
const tools = [
  { id: "bi", num: "01", label: "Brand Identity", caption: "Werte. Positionierung. Bildwelt." },
  { id: "sh", num: "02", label: "Shooting", caption: "Vor dem Dreh: alle Punkte abhaken." },
  { id: "cr", num: "03", label: "Creator Guide", caption: "Wie Content für dich aussieht." },
];
---

<section
  class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-12 gap-y-6 px-6 lg:px-12 py-10"
>
  <div class="space-y-3">
    <span
      class="block font-display italic text-[13px] tracking-[0.12em] uppercase text-ink-warm/60"
      >Aktuell offen</span
    >
    <h2
      id="portalActiveLabel"
      class="font-display text-[clamp(44px,7vw,84px)] leading-[0.95] tracking-[-0.02em] text-ink-warm"
      style="font-variation-settings: 'opsz' 144;"
    >
      Brand Identity
    </h2>
    <p
      id="portalActiveCaption"
      class="font-sans text-[14px] text-ink-soft max-w-[40ch]"
    >
      Werte. Positionierung. Bildwelt.
    </p>
  </div>

  <ol
    id="portalSwitcher"
    class="grid gap-2 self-end font-sans"
  >
    {
      tools.map((t, i) => (
        <li>
          <button
            type="button"
            data-tool={t.id}
            data-num={t.num}
            data-label={t.label}
            data-caption={t.caption}
            class:list={[
              "ptab w-full grid grid-cols-[60px_1fr_auto] items-baseline gap-4 px-4 py-3 text-left rounded-md border-l-[3px] transition-[background-color,border-color] duration-300",
              i === 0
                ? "bg-brand/8 border-l-brand text-ink-warm"
                : "border-l-transparent text-ink-warm/60 hover:bg-brand/5 hover:text-ink-warm",
            ]}
          >
            <span
              class="font-display italic text-[20px] tracking-[0.06em] opacity-70"
              >{t.num}</span
            >
            <span class="font-display text-[22px] leading-tight">{t.label}</span>
            <span
              class="font-sans text-[10px] tracking-[0.18em] uppercase opacity-50"
              >öffnen</span
            >
          </button>
        </li>
      ))
    }
  </ol>
</section>
```

- [ ] **Step 2: Verify compile**

Run: `/usr/bin/curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/portal?room=ABC123`
Expected: `200`.

- [ ] **Step 3: Commit**

```bash
git -C /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace add -A
git -C /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace commit -q -m "feat(portal): numbered tool switcher with editorial typography"
```

---

## Task 5: PortalFrame and PortalFooter components

**Files:**
- Create: `src/components/PortalFrame.astro`
- Create: `src/components/PortalFooter.astro`

- [ ] **Step 1: Write PortalFrame.astro**

```astro
---
// Vellum-style iframe wrapper. The iframe gets id="portalFrame" so
// portal.astro JS can swap its src on tab change.
---

<section
  class="px-6 lg:px-12 pb-12"
>
  <div
    class="relative mx-auto max-w-[1240px] rounded-[14px] bg-card shadow-[0_24px_60px_-30px_rgba(26,24,22,0.45),0_2px_0_0_rgba(193,48,48,0.06)_inset] border-[0.5px] border-line overflow-hidden"
  >
    <div
      aria-hidden="true"
      class="absolute inset-x-0 -top-px h-[2px] bg-gradient-to-r from-transparent via-brand/40 to-transparent"
    >
    </div>
    <iframe
      id="portalFrame"
      src="about:blank"
      title="Tool"
      loading="lazy"
      class="block w-full h-[calc(100vh-360px)] min-h-[480px] border-0 bg-paper"
    ></iframe>
  </div>
</section>
```

- [ ] **Step 2: Write PortalFooter.astro**

```astro
---
const year = new Date().getFullYear();
---

<footer
  class="mt-auto px-6 lg:px-12 py-6 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t border-line/60 text-[11px] text-ink-soft/70 font-sans"
>
  <span class="brand-script text-[18px] text-brand-dark">Unsigned</span>
  <span class="tracking-[0.16em] uppercase">Brand Identity &amp; Tools</span>
  <span class="ml-auto opacity-60">&copy; {year} Unsigned</span>
</footer>
```

- [ ] **Step 3: Verify compile**

Run: `/usr/bin/curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/portal?room=ABC123`
Expected: `200`.

- [ ] **Step 4: Commit**

```bash
git -C /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace add -A
git -C /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace commit -q -m "feat(portal): vellum frame + minimal footer"
```

---

## Task 6: Rewrite portal.astro to compose the new components

**Files:**
- Modify: `src/pages/portal.astro` (full rewrite)

- [ ] **Step 1: Replace the entire file with this**

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import PortalLiveBadge from "../components/PortalLiveBadge.astro";
import PortalToolSwitcher from "../components/PortalToolSwitcher.astro";
import PortalFrame from "../components/PortalFrame.astro";
import PortalFooter from "../components/PortalFooter.astro";

// Room is purely client-derived; we render a placeholder server-side and
// fill it in via the inline script below.
---

<BaseLayout title="Kunden-Portal · Unsigned Workspace">
  <div
    class="min-h-screen flex flex-col bg-paper text-ink-warm grain-overlay relative overflow-x-hidden"
  >
    <header
      class="relative w-full bg-brand text-white fade-up"
      style="animation-delay:60ms"
    >
      <div
        aria-hidden="true"
        class="absolute inset-y-0 right-[-80px] w-[260px] rotate-12 bg-brand-dark opacity-25 pointer-events-none"
      >
      </div>
      <div
        class="relative px-6 lg:px-12 py-5 flex items-center gap-6 flex-wrap"
      >
        <div class="flex items-baseline gap-3">
          <span
            class="font-display italic font-extrabold text-[28px] leading-none tracking-[-0.01em]"
            >Unsigned</span
          >
          <span
            class="brand-script text-[18px] text-white/85 leading-none"
            style="color:#fff"
            >Workspace</span
          >
        </div>
        <span class="hidden md:block ml-2 h-6 w-px bg-white/30"></span>
        <span
          class="hidden md:block font-sans uppercase tracking-[0.22em] text-[10px] text-white/70"
          >Brand Identity &amp; Tools</span
        >
        <div class="ml-auto" id="portalLiveSlot">
          <PortalLiveBadge room="—" />
        </div>
      </div>
    </header>

    <div class="fade-up" style="animation-delay:200ms">
      <PortalToolSwitcher />
    </div>
    <div class="fade-up flex-1" style="animation-delay:340ms">
      <PortalFrame />
    </div>

    <PortalFooter />
  </div>
</BaseLayout>

<script is:inline>
  (function () {
    var room = new URLSearchParams(location.search).get("room");
    var liveSlot = document.getElementById("portalLiveSlot");
    var frame = document.getElementById("portalFrame");
    var switcher = document.getElementById("portalSwitcher");
    var activeLabel = document.getElementById("portalActiveLabel");
    var activeCaption = document.getElementById("portalActiveCaption");

    if (!room) {
      activeLabel.textContent = "Kein Raum-Code";
      activeCaption.textContent = "Bitte den Link von Unsigned öffnen.";
      return;
    }

    // Replace the badge's "—" room placeholder with the actual code
    liveSlot.querySelectorAll("span").forEach(function (s) {
      if (s.textContent === "—") s.textContent = room;
    });

    function ping(tool) {
      if (window.fb && window.firebase) {
        window.fb
          .ref("rooms/" + room + "/clientActivity")
          .set({ tool: tool, ts: window.fb.ts() });
      }
    }

    function setTool(btn) {
      var tool = btn.dataset.tool;
      switcher.querySelectorAll(".ptab").forEach(function (b) {
        var on = b === btn;
        b.classList.toggle("bg-brand/8", on);
        b.classList.toggle("border-l-brand", on);
        b.classList.toggle("border-l-transparent", !on);
        b.classList.toggle("text-ink-warm", on);
        b.classList.toggle("text-ink-warm/60", !on);
      });
      activeLabel.textContent = btn.dataset.label;
      activeCaption.textContent = btn.dataset.caption;
      frame.src = "/tools/" + tool + ".html?room=" + encodeURIComponent(room);
      ping(tool);
    }

    switcher.querySelectorAll(".ptab").forEach(function (b) {
      b.addEventListener("click", function () { setTool(b); });
    });

    // Heartbeat for owner's "Kunde aktiv" indicator
    setInterval(function () {
      var current = switcher.querySelector(".ptab.bg-brand\\/8");
      ping((current && current.dataset.tool) || "bi");
    }, 60000);

    // Auto-open the first tool
    var first = switcher.querySelector(".ptab");
    if (first) setTool(first);
  })();
</script>
```

- [ ] **Step 2: Verify the page returns 200 and the new markup is present**

Run: `/usr/bin/curl -s -o /dev/null -w "%{http_code}" "http://localhost:4321/portal?room=DEMO"`
Expected: `200`

Run: `/usr/bin/curl -s "http://localhost:4321/portal?room=DEMO" | grep -c "portalSwitcher\|portalFrame\|grain-overlay\|fade-up"`
Expected: at least `4`.

- [ ] **Step 3: Commit**

```bash
git -C /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace add -A
git -C /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace commit -q -m "feat(portal): compose redesigned layout"
```

---

## Task 7: Browser smoke test (manual)

**Files:**
- None (visual verification)

- [ ] **Step 1: Open in browser**

Open `http://localhost:4321/portal?room=DEMO123` in a real browser.

- [ ] **Step 2: Verify all of these visually**

Check each:
- [ ] Top bar is full-bleed brand red with "Unsigned" + "Workspace" + DEMO123 + pulsing LIVE badge
- [ ] Below the bar: oversized "Brand Identity" headline in serif (Fraunces, NOT Montserrat)
- [ ] To the right: list of three numbered tools (01/02/03), Brand Identity highlighted with red left bar
- [ ] Iframe renders below in a card with subtle shadow
- [ ] On page load: header → switcher → iframe fade up sequentially (visible stagger)
- [ ] Click "02 Shooting": title swaps, switcher highlight moves, iframe loads sh.html
- [ ] Click "03 Creator Guide": same, with cr.html
- [ ] Subtle grain texture visible on the cream background
- [ ] No layout shift, no font flash, no console errors

- [ ] **Step 3: Take a snapshot of issues found**

If anything is off, list each issue with screenshot path, then fix in a follow-up task. If everything passes, commit a note:

```bash
git -C /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace commit -q --allow-empty -m "test(portal): visual smoke test passed"
```

---

## Task 8: Production build verification

**Files:**
- None

- [ ] **Step 1: Run the build**

Run: `cd /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace && npm run build 2>&1 | tail -30`
Expected: "Complete!" in the final line. No errors. Includes `/portal/index.html`.

- [ ] **Step 2: Verify the built portal page contains expected markup**

Run: `grep -c "portalSwitcher\|portalFrame\|fade-up" dist/portal/index.html`
Expected: at least `3`.

- [ ] **Step 3: Verify Fraunces font is included**

Run: `ls dist/fonts/Fraunces.woff2 && du -h dist/fonts/Fraunces.woff2`
Expected: file exists, ~40-100 KB.

- [ ] **Step 4: Commit (or document blockers)**

```bash
git -C /Users/benrauh/Desktop/HTMLSEITEN/workspace/unsigned-workspace commit -q --allow-empty -m "build(portal): production build green"
```

---

## Self-Review

**Spec coverage:** Each section above maps to a task: tokens (Task 2), font (Task 1), live badge (Task 3), tool switcher (Task 4), frame + footer (Task 5), composition (Task 6), visual verification (Task 7), build (Task 8). ✓

**Placeholder scan:** No "TBD", "implement later", or vague handling left. Each step has runnable commands or full code blocks. ✓

**Type consistency:** Tool IDs `bi/sh/cr` are consistent across switcher and JS. CSS class names referenced from JS (`ptab`, `bg-brand/8`, `border-l-brand`, `text-ink-warm`, `text-ink-warm/60`) match what the component renders. ✓

**One known caveat:** the JS toggles `bg-brand/8` and `border-l-brand` classes that are *also* statically present on the initial active button — Tailwind's purge sees them via the `class:list` static expression in the .astro file, so they're guaranteed to exist in the compiled CSS. No need to safelist.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-05-portal-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

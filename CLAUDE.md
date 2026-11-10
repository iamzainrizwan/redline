# CLAUDE.md

Guidance for Claude Code in this repo. A public repo that only runs on Zain's machine: commit and push
straight to main, no PRs and no worktree branches left lying around. It was split out of `~/rice`
(history included) on 2026-11-10.

## Install and layout

- Installed with `./install.sh --link`: `~/.local/share/gnome-shell/extensions/rice-bar@zain` is a
  link to `rice-bar@zain/` here, and `bin/rice-osd` and `bin/buds` are linked into `~/.local/bin`.
  The rice scripts call `~/.local/bin/rice-osd`.
- GNOME 46 on Wayland only loads a changed extension after a logout. Test changes with
  `bin/rice-bar-test` (headless shell, isolated bus and dconf; keep its two isolation guards) and look
  at the screenshots it writes.
- The tag (`tag.js`) takes pluggable sources: `helm.js` (Zain's planner CLI, picked when it exists)
  and `calendar.js` (GNOME's calendar via the clock menu's `_eventSource`; never open a second
  `DBusEventSource`, because the calendar server keeps one shared time range).
- Every new env var or test mode goes in the README.

## Style

- Black, red and greys only, from `~/rice/palette.md`; never green. Nerd Font glyphs, not emoji.
- Segments hide when there's nothing to say; alerts go red.
- The bar's own `stylesheet.css` must look right without the rice shell theme; that theme
  (in `~/rice/gnome`) only restyles GNOME's menus.
- No personal data in screenshots: README images come from the test's fakes, never real helm data.

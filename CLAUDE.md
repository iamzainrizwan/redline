# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A public repo that only runs on Zain's machine: commit and push straight to main, no PRs and no
worktree branches left lying around. It was split out of `~/rice` (history included) on 2026-11-10 as
rice-bar and renamed redline the same day.

## Commands

- `./install.sh --link`: `~/.local/share/gnome-shell/extensions/redline@zain` becomes a link to
  `redline@zain/` here, and `bin/redline-osd` and `bin/buds` are linked into `~/.local/bin` (the rice
  scripts call `~/.local/bin/redline-osd`). `./install.sh --uninstall` reverses it.
- GNOME 46 on Wayland only loads a changed extension after a logout, so test changes with
  `bin/redline-test` and look at the screenshots it writes (it prints the output dir). It runs a
  headless shell on an isolated bus and dconf, prints the panel layout, and checks a disable/enable
  cycle. The `REDLINE_TEST_*` env vars add fakes (UPower, calendar, player track) and pick what's
  hovered, opened or shown; the table is in the README and the header of `bin/redline-test`. Keep
  its two isolation guards: the XDG vars must be set before `dbus-run-session`, or the test writes
  to the real dconf.
- Lint (what CI runs, `.github/workflows/lint.yml`); there are no unit tests:
  ```sh
  shellcheck install.sh bin/redline-osd bin/redline-test
  python3 -c "compile(open('bin/buds').read(), 'bin/buds', 'exec')"
  for f in redline@zain/*.js; do node --check --input-type=module < "$f" || exit 1; done
  ```

## Architecture

- `extension.js` is the entry point. `SEGMENTS` lists each segment as (statusArea role, class, box,
  position) and adds them with `Main.panel.addToStatusArea`. Each segment is a
  `PanelMenu.Button` subclass in its own file. Everything else in `enable()` changes GNOME's own
  panel: it hides Activities, moves the clock to the far right, and quiets GNOME's icons.
- `disable()` must undo every change exactly, because the lock screen cycles the extension;
  `redline-test` checks this. GNOME icons are hidden with `gateIcon()` (`util.js`), which returns an
  undo function that goes into `this._ungates`. Quick settings' indicators are built
  asynchronously, so `_quietQuickSettings` retries until they exist.
- The code relies on GNOME Shell private fields (`_rightBox`, `_clockDisplay`, `qs._system`,
  `qs._network`, …). Expect breakage on other shell versions; only 46 is supported.
- Hover cards and tooltips (tag card, now-playing card, buds card, `FullTextTooltip`) are chrome
  actors on the stage placed with `placeUnder()`, not PopupMenus. They are added with
  `addTopChrome`/`addChrome`, and each one must remove its chrome on destroy.
- The tag (`tag.js`) takes pluggable sources. The interface (`fetch()`, `view()`,
  `refreshSeconds`, `destroy()`) is documented at the top of `tag.js`, and `pickSource()` chooses
  one. The sources are `helm.js` (Zain's planner CLI, picked when it exists) and `calendar.js`
  (GNOME's calendar via the clock menu's `_eventSource`). Never open a second `DBusEventSource`,
  because the calendar server keeps one shared time range.
- Out-of-process helpers: `bin/buds` (Python, the Nothing/CMF Bluetooth protocol) is run by
  `buds.js` for the buds card. `bin/redline-osd` writes `stamp\ticon\ttext` to
  `$XDG_RUNTIME_DIR/redline-osd`, which `osd.js` watches with a file monitor.
- Runtime env vars, used mostly by the test to inject fakes: `REDLINE_TAG`, `REDLINE_HELM`,
  `REDLINE_BUDS`, `REDLINE_UPOWER_BUS=session`, `REDLINE_HOT_PERCENT`, `REDLINE_OSD_FILE`. Every new
  env var or test mode goes in the README.

## Style

- Black, red and greys only, from `~/rice/palette.md`; never green. Nerd Font glyphs, not emoji.
- Segments hide when there's nothing to say; alerts go red.
- The bar's own `stylesheet.css` must look right without the rice shell theme; that theme
  (in `~/rice/gnome`) only restyles GNOME's menus.
- No personal data in screenshots: README images come from the test's fakes, never real helm data.

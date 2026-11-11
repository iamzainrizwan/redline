// Tag source (tag.js) for helm, my day planner: [helm 14:30 leetcode], what
// to do next, from `helm missed`. Used when the helm CLI is installed.
// Red when a floor block is missed (unticked and its time has started, or
// untimed): it names the first, which helm's own ranking (uni > cybersoc > leetcode
// > c++ > applications > s3ntry/ledgr, floor before stretch) puts first.
// Dark when nothing is missed: it names the next block to start. "helm" +
// a tick when the day's blocks are all done. Hover for the list.
//
// Data: ~/vault/helm/cli/helm missed --all --json, every REFRESH_SECONDS
// and on hover; --all adds the blocks that haven't started, and "started"
// is judged here the way helm judges it (untimed counts; an earlier day
// has all started). Until DAY_STARTS (05:00) the bar asks for yesterday
// by date, an hour past helm's own 04:00 rollover. The order is helm's; it's
// never re-sorted here. If the CLI fails it's retried with HELM_URL set to
// FALLBACK_URL, and if that fails too the tag falls back to the hostname.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

const HELM = GLib.getenv('REDLINE_HELM') ??
    GLib.build_filenamev([GLib.get_home_dir(), 'vault', 'helm', 'cli', 'helm']);
const FALLBACK_URL = 'http://alexandria/helm/api';
const REFRESH_SECONDS = 300;
const TICK = ''; // nf-fa-check
const DAY_STARTS = 5; // the bar's day rolls over at 05:00

function hours(h) {
    return `${Math.round(h * 10) / 10}`.replace(/\.0$/, '');
}

// the day the bar shows: yesterday until DAY_STARTS
function helmDay() {
    const now = GLib.DateTime.new_now_local();
    return (now.get_hour() < DAY_STARTS ? now.add_days(-1) : now).format('%Y-%m-%d');
}

async function runHelm(env = {}) {
    const launcher = new Gio.SubprocessLauncher({
        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
    });
    for (const [key, value] of Object.entries(env))
        launcher.setenv(key, value, true);
    const proc = launcher.spawnv([HELM, 'missed', helmDay(), '--all', '--json']);
    const [stdout] = await proc.communicate_utf8_async(null, null);
    if (!proc.get_successful())
        throw new Error(`helm exited ${proc.get_exit_status()}`);
    return JSON.parse(stdout);
}

export function helmInstalled() {
    return GLib.file_test(HELM, GLib.FileTest.IS_EXECUTABLE);
}

export class HelmSource {
    constructor() {
        this.refreshSeconds = REFRESH_SECONDS;
        this.unreachable = 'helm unreachable';
    }

    async fetch() {
        try {
            return await runHelm();
        } catch {
            return await runHelm({HELM_URL: FALLBACK_URL});
        }
    }

    view(data) {
        if (!data?.blocks)
            return null;
        const now = GLib.DateTime.new_now_local();
        const today = now.format('%Y-%m-%d');
        const time = now.format('%H:%M');
        // helm's rule: an earlier day has all started; today, untimed blocks
        // and ones whose time has come
        const started = b => data.date < today || !b.at || b.at <= time;

        const missed = data.blocks.filter(started);
        const upcoming = data.blocks.filter(b => !started(b));
        // a missed floor block first, then the next to start; a missed
        // stretch block (often untimed, so "started" all day) only when
        // nothing else is left, or it would hide the next floor block
        const next = missed.find(b => b.floor) ??
            upcoming.reduce((a, b) => (a && a.at <= b.at ? a : b), null) ??
            missed[0];

        let label;
        if (next)
            label = ['helm', next.at, next.project].filter(Boolean).join(' ');
        else
            label = `helm ${TICK}`;
        // red for missed floor only: stretch is optional
        const hot = missed.some(b => b.floor);

        const sum = (blocks, f = () => true) =>
            blocks.filter(f).reduce((h, b) => h + (Number(b.hours) || 0), 0);
        const header = missed.length
            ? `missed ${missed.length} · ${hours(sum(missed))}h (${hours(sum(missed, b => b.floor))}h floor)`
            : `nothing missed  ${TICK}`;
        // fields can come back null; one bad block mustn't blank the card
        const rows = data.blocks.map(b => ({
            at: b.at, project: b.project, tier: b.tier ?? '',
            task: `${b.label ?? b.task ?? ''}`,
            kind: !b.floor ? 'dim' : started(b) ? 'hot' : '',
        }));
        return {label, hot, header, rows};
    }

    destroy() {}
}

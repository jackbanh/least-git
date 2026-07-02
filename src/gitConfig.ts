// Shared definitions for the Git Config settings shown in the Settings modal.
// Extracted so the "not following recommendation" count can be reused by the
// Settings nav badge and the toolbar button badge, not just the rows.

export interface GitConfigSetting {
  /** git config key, e.g. "core.fsmonitor". Shown verbatim as the row title. */
  key: string;
  /** Short, plain-English explanation. Written for non-native readers. */
  description: string;
  docsUrl: string;
  /**
   * Recommended switch position. Most settings are "on"; maintenance.auto is
   * "off" because we recommend disabling Git's automatic maintenance.
   */
  recommend: "on" | "off";
  /** git value written when the switch is turned ON. */
  onValue: string;
  /** git value written when the switch is turned OFF (null = unset the key). */
  offValue: string | null;
  /** Current switch position derived from the stored value (null = unset). */
  isSwitchOn: (stored: string | null) => boolean;
  /** Optional version requirement, shown as a small chip (e.g. "Git ≥ 2.37"). */
  requires?: string;
}

// The switch reflects the config key's own state (on = the key is enabled), and
// each setting declares which position we recommend. "Following the
// recommendation" means the switch sits in its recommended position.
export const GIT_CONFIG_SETTINGS: GitConfigSetting[] = [
  {
    key: "core.fsmonitor",
    description:
      "Git watches your files in the background and checks only the ones that " +
      "changed. This makes status checks much faster in large projects.",
    docsUrl: "https://git-scm.com/docs/git-config#Documentation/git-config.txt-corefsmonitor",
    recommend: "on",
    onValue: "true",
    offValue: null,
    isSwitchOn: (v) => v === "true",
    requires: "Git ≥ 2.37",
  },
  {
    key: "core.untrackedCache",
    description:
      "Git remembers which folders have new files and skips folders that did " +
      "not change. Works best together with FSMonitor. Avoid on network drives, " +
      "where file times can be wrong.",
    docsUrl: "https://git-scm.com/docs/git-config#Documentation/git-config.txt-coreuntrackedCache",
    recommend: "on",
    onValue: "true",
    offValue: null,
    isSwitchOn: (v) => v === "true",
  },
  {
    key: "feature.manyFiles",
    description:
      "Turns on a group of speed settings for projects with many files. It uses " +
      "a smaller index format and the untracked cache.",
    docsUrl: "https://git-scm.com/docs/git-config#Documentation/git-config.txt-featuremanyFiles",
    recommend: "on",
    onValue: "true",
    offValue: null,
    isSwitchOn: (v) => v === "true",
  },
  {
    key: "core.commitGraph",
    description:
      "Git keeps a small map of how commits connect. This makes log and history " +
      "commands much faster. On by default in Git 2.24 and newer.",
    docsUrl: "https://git-scm.com/docs/git-config#Documentation/git-config.txt-corecommitGraph",
    recommend: "on",
    onValue: "true",
    offValue: null,
    isSwitchOn: (v) => v === "true",
  },
  {
    key: "fetch.writeCommitGraph",
    description:
      "Git updates the commit map after every fetch so it stays current. This " +
      "adds only a few milliseconds.",
    docsUrl: "https://git-scm.com/docs/git-config#Documentation/git-config.txt-fetchwriteCommitGraph",
    recommend: "on",
    onValue: "true",
    offValue: null,
    isSwitchOn: (v) => v === "true",
  },
  {
    key: "maintenance.auto",
    description:
      "Lets Git run cleanup jobs automatically while you work. On a large repo " +
      "these jobs can pause your commands for minutes. Better to keep this off " +
      "and run cleanup yourself with “git maintenance run”.",
    docsUrl: "https://git-scm.com/docs/git-config#Documentation/git-config.txt-maintenanceauto",
    recommend: "off",
    // ON = re-enable auto maintenance; OFF = explicitly disable it (default is on,
    // so unsetting is not enough — we must write false).
    onValue: "true",
    offValue: "false",
    isSwitchOn: (v) => v !== "false",
  },
  {
    key: "push.autoSetupRemote",
    description:
      "When you push a new branch, Git links it to the remote for you. After " +
      "that, pull and push work with no extra options.",
    docsUrl: "https://git-scm.com/docs/git-config#Documentation/git-config.txt-pushautoSetupRemote",
    recommend: "on",
    onValue: "true",
    offValue: null,
    isSwitchOn: (v) => v === "true",
    requires: "Git ≥ 2.37",
  },
];

export const CONFIG_KEYS = GIT_CONFIG_SETTINGS.map((s) => s.key);

/** Current switch position for `setting` given the stored config values. */
export function switchOn(
  setting: GitConfigSetting,
  values: Record<string, string | null> | null,
): boolean {
  return setting.isSwitchOn(values?.[setting.key] ?? null);
}

/** True when the switch sits in its recommended position. */
export function isFollowing(
  setting: GitConfigSetting,
  values: Record<string, string | null> | null,
): boolean {
  return switchOn(setting, values) === (setting.recommend === "on");
}

/**
 * How many settings are NOT following the recommendation. Returns 0 while
 * `values` is still null (not loaded) so no badge flashes during the fetch.
 */
export function countNotFollowing(values: Record<string, string | null> | null): number {
  if (!values) return 0;
  return GIT_CONFIG_SETTINGS.reduce((n, s) => n + (isFollowing(s, values) ? 0 : 1), 0);
}

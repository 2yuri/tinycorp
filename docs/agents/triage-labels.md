# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## The rest of the labels

Triage picks from the five above; these are the ones that say *where* an issue is and *who* it is
for. They exist in the repo (`gh label list`), and an issue form applies the first two of them by
itself.

| Label | What it means |
| --- | --- |
| `bug` | applied by the bug form |
| `enhancement` | applied by the feature and Provider/forge forms |
| `good first issue` | small, self-contained, and the guide it needs is already written |
| `help wanted` | we would like somebody outside to take this |
| `area:provider` | a Provider adapter or the Provider contract |
| `area:forge` | a forge adapter or the forge contract |
| `area:office` | the pixel office and its sprites |
| `area:ui` | the renderer: screens, components, design fidelity |
| `platform:windows` | Windows, native or WSL |
| `platform:linux` | Linux: AppImage, `.deb`, keyring, tray |

A bug that only happens on one platform gets that platform's label, because that is the thing a
reader needs to know before they can reproduce it. There is no `platform:macos`: it is where the app
is developed, so an unlabelled bug is a macOS bug until somebody says otherwise.

Creating them on a fresh clone of this repo, or after a rename:

```sh
gh label create 'good first issue' --color 7057ff --description 'Good for newcomers' --force
gh label create 'help wanted' --color 008672 --description 'Extra attention is needed' --force
gh label create 'area:provider' --color 5319e7 --description 'A Provider adapter or the Provider contract' --force
gh label create 'area:forge' --color 006b75 --description 'A forge adapter or the forge contract' --force
gh label create 'area:office' --color c2e0c6 --description 'The pixel office and its sprites' --force
gh label create 'area:ui' --color bfd4f2 --description 'The renderer: screens, components, design fidelity' --force
gh label create 'platform:windows' --color 1d76db --description 'Windows, native or WSL' --force
gh label create 'platform:linux' --color fef2c0 --description 'Linux: AppImage, .deb, keyring, tray' --force
```

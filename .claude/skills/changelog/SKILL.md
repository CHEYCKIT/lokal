---
name: changelog
description: Write the release notes (changelog) for a Lokal version, in Markdown, from the commits merged since the previous release tag. Use when asked for a changelog, release notes or "what's new" for a version.
---

# Changelog

Write the changelog for a Lokal release, ready to paste into the GitHub release.

## 1. Find what's in the release

```bash
git fetch upstream main --tags --force   # upstream = github.com/sipbuu/lokal
git tag --sort=-creatordate | head        # the version asked for and the one before it
git log --oneline --first-parent vPREV..vNEW          # the merged PRs
git log --no-merges --format='%s%n%b' vPREV..vNEW     # what each one did
```

- If the new version has no tag yet, use `vPREV..upstream/main`.
- Skip nightly tags (`-nightly.N`) when picking the previous version, unless the user asks for a nightly.
- Read the commit bodies, not only the titles. Leave out version bumps, merges and README-only changes unless they matter to users. Leave out fixes for bugs that were never released (a fix to a feature added in the same release is part of that feature).

## 2. Write it

Output **one Markdown code block**, and nothing before the first heading:

- **No title** (no `# Lokal X.Y.Z`): the GitHub release already shows the version.
- **No "Full changelog" link** at the end.
- Three sections, in this order, each left out when empty:

```markdown
## ✨ New
- **Feature name**: what it does for the user, in one or two sentences.

## 🔧 Improved
- **Area**: what got better.

## 🐛 Fixed
- **Area**: what was wrong, now fixed.
```

Style:
- Emojis on the section headers only, never on the items.
- Each item starts with a short **bold name**, then a colon, then plain words.
- One language and tone throughout: plain English, written for people who use the app, not developers. Say what changed for them ("Play works when the full album online is shown"), not how ("disabled condition uses merged.tracks").
- No file names, function names, PR numbers or commit hashes.
- Group related commits into one item. Where it helps, name where to find a feature (e.g. "Settings → Integrations → Soulseek").
- Keep each item short. Break up a long one into a bold lead line with sub-bullets rather than a long paragraph.

## 3. Check before answering

- Every item comes from a commit in the range. Nothing is invented or guessed.
- Each change is listed once, in the right section.
- No `# Lokal …` title and no "Full changelog" line.

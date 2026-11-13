#!/usr/bin/env bash
# Opens or updates the release PR (branch release/next): the next version from the Conventional Commits
# since the last tag (git-cliff, cliff.toml) in package.json, and its section on top of CHANGELOG.md.
# Run by .github/workflows/release.yml on every push to main; see docs/releasing.md.
#
#   scripts/release-pr.sh --dry-run   prints the next version and its changelog section, changes nothing
#
# A `Release-As: x.y.z` footer in any commit since the last tag sets the version explicitly.
set -euo pipefail

cliff=(npx --yes git-cliff@2.14.2)
branch=release/next
dry_run=false
[ "${1:-}" = "--dry-run" ] && dry_run=true

# Only the commits since the last tag (`git log <tag>..HEAD`), the hidden types already left out
context=$("${cliff[@]}" --unreleased --context 2>/dev/null)
count=$(node -e 'const c = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(c[0]?.commits.length ?? 0)' <<<"$context")
last_tag=$(node -e 'const c = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(c[0]?.previous?.version ?? "")' <<<"$context")
range="${last_tag:+$last_tag..}HEAD"

release_as=$(git log "$range" --format=%B | sed -n 's/^Release-As: *v\{0,1\}\([0-9][0-9.]*\).*$/\1/p' | head -n 1)

if [ "$count" -eq 0 ] && [ -z "$release_as" ]; then
  echo "No changes for the changelog since ${last_tag:-the first commit}: no release PR"
  exit 0
fi

version=${release_as:-$("${cliff[@]}" --unreleased --bumped-version 2>/dev/null)}
version=${version#v}
# The section without the blank lines git-cliff leaves at its end
section=$("${cliff[@]}" --unreleased --tag "v$version" --strip all 2>/dev/null | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')

echo "Next version: $version (since ${last_tag:-the first commit})"
echo "$section"
$dry_run && exit 0

git switch --force-create "$branch"
npm pkg set version="$version"
SECTION="$section" node -e '
  const fs = require("fs");
  const header = "# Changelog\n\n";
  const old = fs.readFileSync("CHANGELOG.md", "utf8");
  if (!old.startsWith(header)) throw new Error("CHANGELOG.md does not start with \"# Changelog\"");
  fs.writeFileSync("CHANGELOG.md", header + process.env.SECTION.trim() + "\n\n" + old.slice(header.length));
'
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit --quiet --all --message "chore(release): $version"
git push --force --quiet origin "$branch"

title="chore(release): $version"
body="Release **v$version**. Merging this PR tags \`v$version\`, creates the GitHub release and submits it to the Chrome Web Store and AMO (\`docs/releasing.md\`). Updated on every push to \`main\`.

---

$section"
pr=$(gh pr list --head "$branch" --base main --state open --json number --jq '.[0].number // empty')
if [ -n "$pr" ]; then
  gh pr edit "$pr" --title "$title" --body "$body"
else
  gh pr create --head "$branch" --base main --title "$title" --body "$body"
fi

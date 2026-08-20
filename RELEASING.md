# Releasing a new version of NEO — the checklist

(For future Hugh, who has been writing novels and has forgotten all of this.)

## 1. Bump, commit, tag, and push — the short way

```
cd ~/Downloads/NEO
git add .
git commit -m "what changed"
npm version patch        <- bug fixes (0.3.0 → 0.3.1); use `npm version minor` for features (→ 0.4.0)
git push
git push --tags
```

`npm version` bumps package.json, commits it, AND creates the matching tag in
one stroke — so the version and tag can never disagree. (If Claude already
bumped the version during the work session, skip the npm version line and tag
by hand: `git tag v0.X.X`.)

Pushing the tag wakes the GitHub robots (Actions tab). They build Windows on a
real Windows machine — and boot-test it — plus the Linux AppImage, and attach
everything to a DRAFT release.

## 2. Build the signed Mac version locally

```
cd ~/Downloads/NEO
export APPLE_ID=hughhowey@hotmail.com
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx   <- app-specific password, account.apple.com
export APPLE_TEAM_ID=9GDD7TVUNB
npm run package
```

Notes to remember:
- All four lines in the SAME Terminal window (exports vanish when it closes).
- The long silent pause near the end is Apple notarizing. 5–15 min. Not stuck.
- If the app-specific password stops working, you probably changed your Apple ID
  password — generate a new one at account.apple.com → App-Specific Passwords.

## 3. Check the robots

Repo → Actions tab. Both jobs green? Good. Windows red? Open the log — it shows
the real error from a real Windows machine. Fix before publishing.

## 4. Publish the release

Repo → Releases → open the DRAFT the robots made → Edit:

1. Drag in the Mac files from `dist/`:
   - `NEO-0.X.X-universal.dmg`
   - `NEO-0.X.X-universal-mac.zip`
   - `latest-mac.yml`
   - the `.blockmap` file(s)
2. Confirm the robot files are present: Setup .exe, portable .exe, `latest.yml`,
   AppImage, `latest-linux.yml`.
3. Write the release notes (what changed, any warnings for Windows users).
4. Publish.

Signed Mac installs auto-update from here. Windows/Linux users download fresh.

## If something goes wrong

- `git push` rejected → `git pull origin main --rebase`, then push again.
- Notarize 401 → regenerate the app-specific password.
- "dquote>" in Terminal → you have an unclosed quote; Ctrl+C and retype without quotes.
- Anything else → ask Claude, and paste the exact error text.

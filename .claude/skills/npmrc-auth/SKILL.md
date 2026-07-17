---
name: npmrc-auth
description: >
  Before running any npm install or npm ci command, automatically ensure ~/.npmrc is fresh and
  correctly configured for the Equestria private registry. Use this skill whenever you are about
  to call `npm install`, `npm ci`, or any command that installs npm packages. Triggers on any
  mention of installing npm dependencies, running npm install/ci, or setting up a Node.js project.
  Even if the user just says "install dependencies" or "set up the project", use this skill first.
---

# npmrc-auth

Before running `npm install` or `npm ci` or `yarn install`, always execute this pre-flight check.

## Step 1: Check ~/.npmrc freshness

```bash
node --eval "
const fs = require('fs');
const os = require('os');
const path = require('path');
const p = path.join(os.homedir(), '.npmrc');
try {
  const ageMinutes = (Date.now() - fs.statSync(p).mtimeMs) / 60000;
  console.log('EXISTS:' + ageMinutes.toFixed(1));
} catch {
  console.log('MISSING');
}
"
```

- If output is `MISSING`, or the age in minutes is **> 55**, proceed to Step 2.
- Otherwise, skip to Step 3.

## Step 2: Write ~/.npmrc and authenticate

If `yarn install` is being used, write exactly this content to `~/.npmrc` (overwrite if it exists):

```
always-auth=true
registry=https://us-west1-npm.pkg.dev/equestria-dev-47499/npmjs-mirror/
@equestria:registry=https://us-west1-npm.pkg.dev/equestria-dev-47499/toku-npm/
@illumass:registry=https://us-west1-npm.pkg.dev/equestria-dev-47499/toku-npm/
@new-mareland:registry=https://us-west1-npm.pkg.dev/equestria-dev-47499/toku-npm/
@new-mareland-module:registry=https://us-west1-npm.pkg.dev/equestria-dev-47499/toku-npm/
@new-mareland-grafana-plugin:registry=https://us-west1-npm.pkg.dev/equestria-dev-47499/toku-npm/
//us-west1-npm.pkg.dev/equestria-dev-47499/toku-npm/:always-auth=true
//us-west1-npm.pkg.dev/equestria-dev-47499/npmjs-mirror/:always-auth=true
```

Else, write exactly this content to `~/.npmrc` (overwrite if it exists):

```
registry=https://us-west1-npm.pkg.dev/equestria-dev-47499/npmjs-mirror/
@equestria:registry=https://us-west1-npm.pkg.dev/equestria-dev-47499/toku-npm/
@illumass:registry=https://us-west1-npm.pkg.dev/equestria-dev-47499/toku-npm/
@new-mareland:registry=https://us-west1-npm.pkg.dev/equestria-dev-47499/toku-npm/
@new-mareland-module:registry=https://us-west1-npm.pkg.dev/equestria-dev-47499/toku-npm/
@new-mareland-grafana-plugin:registry=https://us-west1-npm.pkg.dev/equestria-dev-47499/toku-npm/
```

Then run the auth helper:

```bash
npx --registry https://registry.npmjs.org google-artifactregistry-auth
```

> **Important:** The `--registry https://registry.npmjs.org` flag is required so npx fetches the
> auth tool from public npm, not the private mirror (which would create a chicken-and-egg problem).

If `google-artifactregistry-auth` exits with a non-zero status, **stop immediately** — do not
proceed with `npm install`, `npm ci`, or `yarn install`. Report the error to the user and ask them to resolve
authentication before retrying.

## Step 3: Proceed with npm install / npm ci / yarn install

Run the originally intended npm or yarn command now that auth is confirmed fresh.

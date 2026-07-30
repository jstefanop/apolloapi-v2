# Apollo API v2

Backend and device management service for Apollo systems. In production this repo is installed on the device at `/opt/apolloapi`, runs the API directly with Node.js, builds the UI on-device, and manages miner/node/solo services through `systemd`.

## Local Development

### Requirements

- Node.js `21.x`
- Yarn

### Install

```sh
yarn
```

### Run

```sh
yarn dev
```

On first start the app will:

1. Create `.env` in the repo root if it does not exist.
2. Set `DATABASE_URL` to `futurebit.sqlite`.
3. Generate `APP_SECRET`.
4. Run pending SQLite migrations.
5. Start the API from `src/init.js`.

The development entrypoint is the API only. The production UI lives in the separate `apolloui-v2` repo and is installed on devices under `/opt/apolloapi/apolloui-v2`.

## Production Install

The old cross-build / tarball workflow is obsolete. Current devices have enough RAM to install dependencies and build the UI directly on the device.

### Main installer

For a standard device image install from a checked out repo, use:

```sh
sudo bash backend/utils/image_install
```

For a one-command install directly from the `main` branch, use:

```sh
curl -fsSL https://raw.githubusercontent.com/jstefanop/apolloapi-v2/main/backend/utils/image_install | sudo bash
```

These installers perform the full device setup:

- Install required Debian packages.
- Create the `futurebit` user.
- Clone `apolloapi-v2` into `/opt/apolloapi`.
- Clone `apolloui-v2` into `/opt/apolloapi/apolloui-v2`.
- Install NVM, Node `21.6.2`, and Yarn.
- Create `.env` files for the API and UI.
- Run `yarn` for the API.
- Run `yarn install` and `yarn build` for the UI on-device.
- Install bundled miner, node, and ckpool binaries for the device architecture.
- Copy `systemd` unit files into `/etc/systemd/system`.

### Alternate installer

There is also a repo installer at:

```sh
sudo bash backend/install-v2
```

It follows the same general flow and supports:

```sh
sudo bash backend/install-v2 dev
sudo bash backend/install-v2 dev <branch>
```

Use the `backend/utils/` installers for current image/device setup unless you specifically need the older `install-v2` path.

### Staged release images

To install a release candidate without publishing it on `main`, create matching
`staging` branches in both `apolloapi-v2` and `apolloui-v2`, then run:

```sh
sudo bash backend/utils/image_install dev staging
```

A staging install requires the UI staging branch; it will not fall back to
`dev`. The branch-aware `backend/update` and its
`backend/utils/update_git.sh` helper must already be present on staging before
the image is installed.

Keep the staged UI version higher than the version currently published on
`main`, and keep the API and UI `package.json` versions in step with each other.
Staged devices stay frozen for as long as that holds. When the release is ready:

1. Merge the matching API and UI staging branches into `main`.
2. Publish a UI version strictly newer than the staged one, for example `2.1.4`
   over a staged `2.1.3`.
3. Run the normal update from the UI.

Production update checks continue to watch the UI `main` version. Once that
version is newer, `backend/update` explicitly fetches and switches both device
repositories to `main`, then builds and reboots as usual. It does not install
later staging commits. Manually running `backend/update` on any non-main
checkout also intentionally moves both repositories to `main`.

After the reboot, verify the migration with:

```sh
git -C /opt/apolloapi branch --show-current
git -C /opt/apolloapi/apolloui-v2 branch --show-current
```

Both commands must report `main`. The factory-only `image_update` scripts keep
their existing branch behavior and are not the staging-to-main promotion path.
Devices already on `main` still use their previously installed updater for the
first release containing this helper; the new safeguards apply after that
bootstrap update succeeds.

## Production Updates

For image/device installs that were originally set up with `image_install`, use:

```sh
sudo bash backend/utils/image_update
```

For repo-managed updates, use:

```sh
sudo bash backend/update
```

Notes:

- These update scripts assume the production install lives at `/opt/apolloapi`.
- They stop production services, refresh code, reinstall dependencies, rebuild the UI on-device, refresh bundled binaries, and reload `systemd`.
- They are not safe for preserving local uncommitted changes inside `/opt/apolloapi`; some paths use `git reset --hard`.

## Production Services

The production install copies the following units into `/etc/systemd/system`:

- `apollo-api.service`
- `apollo-ui-v2.service`
- `apollo-miner.service`
- `node.service`
- `ckpool.service`
- `rc-local.service`
- `swap.service` on image installs that enable swap

### Common commands

Check status:

```sh
sudo systemctl status apollo-api apollo-ui-v2 apollo-miner node ckpool
```

Restart the API and UI:

```sh
sudo systemctl restart apollo-api apollo-ui-v2
```

Control miner, node, or solo pool individually:

```sh
sudo systemctl start apollo-miner
sudo systemctl stop node
sudo systemctl restart ckpool
```

Enable a service at boot:

```sh
sudo systemctl enable apollo-api
```

Reload unit files after changing service definitions:

```sh
sudo systemctl daemon-reload
```

### Service startup order

The shipped units currently start in this order:

- `rc-local.service`
- `apollo-api.service`
- `apollo-ui-v2.service`
- `node.service`
- `ckpool.service`

`apollo-miner.service` also starts after the network and `rc-local.service`.

### Logs

Use `journalctl` for service logs:

```sh
sudo journalctl -u apollo-api -f
sudo journalctl -u apollo-ui-v2 -f
sudo journalctl -u node -f
sudo journalctl -u apollo-miner -f
sudo journalctl -u ckpool -f
```

## Runtime Layout

Production installs expect these paths:

- API repo: `/opt/apolloapi`
- UI repo: `/opt/apolloapi/apolloui-v2`
- SQLite DB: `/opt/apolloapi/futurebit.sqlite`
- API env file: `/opt/apolloapi/.env`
- Node config: `/opt/apolloapi/backend/node/`
- ckpool config/logs: `/opt/apolloapi/backend/ckpool/`

## Networking / System Utilities

- NetworkManager CLI is available via `nmcli`.
- Firewall setup is handled by `backend/firewall` and is wired into boot via `rc.local`.
- Tor is installed by the production installers and kept disabled until enabled by the system/app flow.

## Uninstall

To remove the production install:

```sh
sudo bash backend/uninstall-v2
```

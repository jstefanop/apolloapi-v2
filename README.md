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

## Updates

For a deployed device, use the live updater:

```sh
sudo bash backend/update
```

The scripts below are only for building production SD card images:

```sh
sudo bash backend/utils/image_update
sudo bash backend/utils/image_update_solo-node
```

Notes:

- `backend/update` preserves device settings and runtime credentials, then reboots.
- The `image_update*` scripts are intentionally destructive factory tools. They
  erase the database and runtime credentials, leave services stopped, and must
  never be run on a deployed customer device.
- All update paths assume the install lives at `/opt/apolloapi` and may use
  `git reset --hard`.

## Production Services

The production install copies the following units into `/etc/systemd/system`:

- `apollo-bootstrap.service`
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

Inspect the live Bitcoin or CKPool console:

```sh
screen -r node
screen -r ckpool
```

Detach without stopping the process with `Ctrl-A`, then `D`. These attachable
Screen sessions are a supported operational feature; systemd tracks their
non-forking foreground Screen processes.

### Service startup order

The shipped units currently start in this order:

- `rc-local.service`
- `apollo-bootstrap.service`
- `apollo-api.service` and `node.service`
- `apollo-ui-v2.service` after the API
- `ckpool.service`

`apollo-miner.service` also starts after the network and `rc-local.service`.
The root-filesystem resize is attempted only once, independently of NVMe
availability. When no node NVMe is installed, the node, CKPool, and NVMe swap
units are skipped without entering their restart loops.

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
- Managed node and CKPool runtime state: `/var/lib/apollo/`
- CKPool logs: `/opt/apolloapi/backend/ckpool/logs/`

## Networking / System Utilities

- NetworkManager CLI is available via `nmcli`.
- Firewall setup is handled by `backend/firewall` and is wired into boot via `rc.local`.
- Tor is installed by the production installers and kept disabled until enabled by the system/app flow.

## Uninstall

To remove the production install:

```sh
sudo bash backend/uninstall-v2
```

# Apollo API v2 - Docker Test Environment

This repo provides two Docker-based workflows: **unit/integration tests** (no device) and **full install test** (Armbian-like with systemd).

---

## 1. Run test suite (Jest) — no Apollo device needed

Use this to verify the codebase (including the [implemented security/reliability fixes](docs/IMPLEMENTED_FIXES.md)) without an Apollo device or Armbian.

**Build and run tests:**

```bash
docker-compose run --rm test
```

This builds the image from `Dockerfile.test` (Node 21 + npm install), runs `npm test` (Jest with in-memory SQLite), and exits. No systemd, no install script.

**Run tests with local source (faster iteration):**

```bash
docker-compose run --rm -v "$(pwd)":/app -v /app/node_modules test npm test
```

The first volume mounts the project; the anonymous volume keeps container `node_modules` so the host doesn’t overwrite them.

**Run tests locally (no Docker):**

Requires Node 21+ (see `package.json` engines). If you use nvm:

```bash
nvm use
NODE_ENV=test npm test
```

---

## 2. Integration tests in Docker (real system commands)

These tests run **inside Docker** with real commands to verify the security fixes (no shell interpolation):

- **chpasswd**: the app really changes the `futurebit` user password via `spawn('sudo', ['chpasswd'])` and stdin; we verify by reading `/etc/shadow` before/after.
- **nmcli**: a stub `nmcli` in the container logs its argv to `/tmp/nmcli-args`; we run the same spawn pattern the app uses and assert that SSID and passphrase are separate arguments (so a value like `Net'; echo pwned` is one arg, not interpreted by a shell).

**Run integration tests:**

```bash
docker-compose run --rm integration
```

Build and run manually:

```bash
docker build -f Dockerfile.integration -t apollo-integration .
docker run --rm apollo-integration
```

The image includes a `futurebit` user and a fake `nmcli` at `/usr/local/bin/nmcli`; the test runner is `scripts/integration-test-runner.js`.

---

## 3. Full install test (systemd / Armbian-like)

The main Dockerfile tests the `install-v2` script in an environment that simulates Armbian.

### Purpose

- **Test install-v2 script**: Verify that the complete installation works
- **Simulate Armbian**: Debian Bookworm + systemd environment like Armbian 25.8.1
- **Debugging**: Identify any issues in the installation process

## Features

- **Base**: Debian Bookworm (compatible with Armbian 25.8.1)
- **Systemd**: Enabled to manage services like in production
- **Original script**: Runs `backend/install-v2 dev` without modifications
- **Complete logging**: All installation steps are visible

## Usage

### Quick installation test

```bash
# Build and start container (runs systemd + install-v2)
docker-compose up --build apollo-test

# View installation logs
docker-compose logs -f apollo-test
```

### Manual testing (install flow)

```bash
# Build image
docker build -t apollo-install-test .

# Start container for testing
docker run -it --privileged \
  -v /sys/fs/cgroup:/sys/fs/cgroup:ro \
  apollo-install-test

# Inside container you can run manually:
# bash /opt/test-install.sh
```

## What the test does

1. **Copies project** to `/tmp/apolloapi-v2/`
2. **Runs install-v2 dev** with all original parameters
3. **Installs all system packages** required
4. **Configures NVM and Node.js** 21.6.2
5. **Installs dependencies** for API and UI
6. **Configures systemd** services
7. **Checks status** of installed services

## Expected output

The test should show:
- ✅ System packages installation
- ✅ Creation of `futurebit` user
- ✅ NVM and Node.js installation
- ✅ API dependencies installation
- ✅ UI dependencies installation
- ✅ UI build
- ✅ Systemd services configuration
- ✅ Services enabling

## Debugging

### If installation fails

```bash
# Access container for debugging
docker exec -it apollo-install-test bash

# Check systemd logs
journalctl -xe

# Run parts of script manually
cd /tmp/apolloapi-v2
bash backend/install-v2 dev
```

### Common issues

1. **Missing packages**: Check that all packages are available in Debian Bookworm
2. **Permissions**: Verify that `futurebit` user has correct permissions
3. **Network**: Check that container can download packages and dependencies
4. **Systemd**: Verify that systemd is configured correctly

## Exposed ports

- **22** - SSH (for future access)
- **80** - HTTP (redirected to 3000)
- **3000** - Apollo UI
- **5000** - Apollo API
- **8333** - Bitcoin
- **3333** - Stratum

## Notes

- Container stops after test (restart: "no")
- Data is not persistent (testing only)
- For continuous development, use separate development environment

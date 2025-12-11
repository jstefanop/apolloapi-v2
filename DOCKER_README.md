# Apollo API v2 - Docker Test Environment

This Dockerfile tests the original `install-v2` script in an environment that simulates Armbian to verify that the installation works correctly.

## Purpose

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
# Build and test installation
docker-compose up --build

# View installation logs
docker-compose logs -f
```

### Manual testing

```bash
# Build image
docker build -t apollo-test .

# Start container for testing
docker run -it --privileged \
  -v /sys/fs/cgroup:/sys/fs/cgroup:ro \
  apollo-test

# Inside container you can run manually:
# bash /tmp/test-install.sh
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

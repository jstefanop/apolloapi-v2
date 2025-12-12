# Dockerfile to test Apollo API v2 install-v2 script with working systemd
# Simulates Armbian environment to test complete installation

FROM debian:bookworm-slim

# Set environment for container
ENV container=docker
STOPSIGNAL SIGRTMIN+3

# Install systemd and base dependencies to simulate Armbian
RUN apt-get update && apt-get install -y \
    systemd \
    systemd-sysv \
    dbus \
    sudo \
    curl \
    git \
    openssh-server \
    && rm -rf /var/lib/apt/lists/*

# Avoid some issues with journald and tmp
VOLUME [ "/sys/fs/cgroup" ]

# Copy entire Apollo project to working directory
COPY . /opt/apolloapi-v2/

# Create necessary directories for Bitcoin node (normally mounted from external drive)
RUN mkdir -p /media/nvme/Bitcoin && \
    chown -R root:root /media/nvme/Bitcoin

# Create a fake NVMe device for Bitcoin node (Docker-specific)
RUN mknod /dev/nvme0n1p1 b 8 1 || true

# Create systemd service for our test script
RUN echo '[Unit]' > /etc/systemd/system/apollo-test.service && \
    echo 'Description=Apollo Install Test' >> /etc/systemd/system/apollo-test.service && \
    echo 'After=multi-user.target' >> /etc/systemd/system/apollo-test.service && \
    echo '' >> /etc/systemd/system/apollo-test.service && \
    echo '[Service]' >> /etc/systemd/system/apollo-test.service && \
    echo 'Type=oneshot' >> /etc/systemd/system/apollo-test.service && \
    echo 'ExecStart=/opt/test-install.sh' >> /etc/systemd/system/apollo-test.service && \
    echo 'RemainAfterExit=yes' >> /etc/systemd/system/apollo-test.service && \
    echo '' >> /etc/systemd/system/apollo-test.service && \
    echo '[Install]' >> /etc/systemd/system/apollo-test.service && \
    echo 'WantedBy=multi-user.target' >> /etc/systemd/system/apollo-test.service

# Create test script that runs install-v2 and then starts services
RUN echo '#!/bin/bash' > /opt/test-install.sh && \
    echo 'set -e' >> /opt/test-install.sh && \
    echo 'echo "=== Testing install-v2 script ==="' >> /opt/test-install.sh && \
    echo 'cd /opt/apolloapi-v2' >> /opt/test-install.sh && \
    echo 'chmod +x backend/install-v2' >> /opt/test-install.sh && \
    echo 'echo "Running install-v2 in dev mode..."' >> /opt/test-install.sh && \
    echo 'bash backend/install-v2 dev' >> /opt/test-install.sh && \
    echo 'echo "=== Installation completed ==="' >> /opt/test-install.sh && \
    echo 'echo "Starting Apollo services..."' >> /opt/test-install.sh && \
    echo 'systemctl start apollo-api' >> /opt/test-install.sh && \
    echo 'systemctl start apollo-ui-v2' >> /opt/test-install.sh && \
    echo 'systemctl disable apollo-miner' >> /opt/test-install.sh && \
    echo 'systemctl start node' >> /opt/test-install.sh && \
    echo 'systemctl start ckpool' >> /opt/test-install.sh && \
    echo 'echo "=== Services started ==="' >> /opt/test-install.sh && \
    echo 'echo "Checking service status..."' >> /opt/test-install.sh && \
    echo 'systemctl status apollo-api apollo-ui-v2 apollo-miner node ckpool --no-pager || true' >> /opt/test-install.sh && \
    echo 'echo "=== Test completed - Services running ==="' >> /opt/test-install.sh && \
    echo 'echo "Apollo API should be available at http://localhost:5000"' >> /opt/test-install.sh && \
    echo 'echo "Apollo UI should be available at http://localhost:3000"' >> /opt/test-install.sh && \
    echo 'echo "Keeping container alive..."' >> /opt/test-install.sh && \
    echo 'tail -f /dev/null' >> /opt/test-install.sh && \
    chmod +x /opt/test-install.sh

# Enable the test service
RUN systemctl enable apollo-test.service

# Expose necessary ports
EXPOSE 22 80 3000 5000 8333 3333

# Run systemd as PID 1
CMD ["/sbin/init"]

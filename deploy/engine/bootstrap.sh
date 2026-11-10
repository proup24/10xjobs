#!/usr/bin/env bash
# One-time (re-runnable) server setup for the hosted engine. Ubuntu 24.04.
# Usage: sudo ./bootstrap.sh <authorized_keys file>
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo $0 <authorized_keys file>" >&2
  exit 1
fi
KEYS_FILE="${1:-}"
if [[ -z "$KEYS_FILE" || ! -s "$KEYS_FILE" ]]; then
  echo "Usage: sudo $0 <authorized_keys file> (the file must exist and not be empty)" >&2
  exit 1
fi

# A bad keys file locks everyone out once the sshd drop-in below is written.
# ssh-keygen -l skips unparseable lines, so also check every key line parsed.
if ! fingerprints="$(ssh-keygen -l -f "$KEYS_FILE" 2>&1)"; then
  echo "$KEYS_FILE has no valid public keys: $fingerprints" >&2
  exit 1
fi
expected="$(grep -cvE '^[[:space:]]*(#|$)' "$KEYS_FILE" || true)"
parsed="$(printf '%s\n' "$fingerprints" | grep -c . || true)"
if [[ "$parsed" -ne "$expected" ]]; then
  echo "$KEYS_FILE has $expected key lines but only $parsed parse as public keys:" >&2
  printf '%s\n' "$fingerprints" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

# 2. Docker Engine and the Compose plugin from Docker's apt repo.
if docker compose version >/dev/null 2>&1; then
  echo "Docker Compose already installed, skipping."
else
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

# 3. The deploy user: docker group, no sudo.
if ! id deploy >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash deploy
fi
usermod -s /bin/bash deploy
usermod -aG docker deploy

# 4. SSH keys for deploy.
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
install -m 600 -o deploy -g deploy "$KEYS_FILE" /home/deploy/.ssh/authorized_keys

# 5. SSH hardening. The 10- prefix sorts before cloud-init's 50-cloud-init.conf, and the first value wins.
cat >/etc/ssh/sshd_config.d/10-xjobs.conf <<'CONF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers deploy
CONF
chmod 644 /etc/ssh/sshd_config.d/10-xjobs.conf
sshd -t
systemctl reload ssh

# 6. Firewall: SSH and web only.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# 7. Automatic security updates. Refresh the package lists first: the Docker
# step above skips its own update when Docker is already installed.
apt-get update
apt-get install -y unattended-upgrades
echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' >/etc/apt/apt.conf.d/20auto-upgrades
systemctl enable --now unattended-upgrades

# 8. Engine directory.
install -d -m 700 -o deploy -g deploy /home/deploy/engine

# 9. Next steps.
cat <<'MSG'

Bootstrap done.

Next steps (see the engine hosting runbook):
  1. From another terminal, confirm you can log in: ssh deploy@<server>. Do this before closing this session.
  2. Create /home/deploy/engine/.env (mode 600) from deploy/engine/.env.example.
  3. Add the deploy secrets to GitHub and run the deploy workflow.

Notes:
  - deploy has no sudo (the docker group is enough).
  - Root SSH is disabled. For root, use the Hetzner console.
MSG

#cloud-config
#
# !! THIS FILE MUST BE PURE ASCII. NON-ASCII CHARACTERS BREAK THE WHOLE DROPLET.
#
# cloud-init parses this as YAML before applying any of it. A single non-ASCII
# byte - an em dash in a comment is enough - fails the parse, and cloud-init
# then applies NOTHING: no deploy user, no Docker, no /opt directory. The
# droplet boots, sshd answers, and every subsequent symptom points somewhere
# else entirely. The log says only:
#
#   Failed loading yaml blob. unacceptable character #x0080 ... position 203
#   Failed at merging in cloud config part from part-001: empty cloud config
#
# This happened: an em dash in the header comment below cost a day of chasing
# an SSH key that was correct all along. `ci-terraform-templates` in
# .github/workflows now fails the build on non-ASCII so it cannot recur.
#
# Bootstrap for the Inngest droplet.
#
# A deliberately stripped-down sibling of cloud-init.yaml.tpl: same deploy user,
# same Docker install, but NO nginx, NO certbot and NO TLS script - this droplet
# serves nothing publicly. Its only inbound rules are SSH and port 8288 from the
# app droplet, both enforced by the DigitalOcean firewall.
#
# !! This is a SEPARATE FILE rather than conditionals inside the app template on
# purpose. `user_data` cannot be changed in place: editing the app template
# REPLACES the running app droplet. Keeping the two apart means work on one can
# never destroy the other.
package_update: true
# Deliberately NOT package_upgrade. On this image it pulls a kernel update,
# which opens an interactive whiptail dialog that nothing can answer on an
# unattended boot - it stalled runcmd for minutes and printed "Failed to open
# terminal". Security updates are handled by unattended-upgrades; a first-boot
# full upgrade buys little and delays the droplet becoming usable.

users:
  - name: deploy
    groups: sudo, docker
    shell: /bin/bash
    sudo: ["ALL=(ALL) NOPASSWD:ALL"]
    ssh_authorized_keys:
      - ${ssh_public_key}

write_files:
  - path: /opt/sfa-inngest/README.txt
    permissions: "0644"
    content: |
      Self-hosted Inngest - the durable event bus, scheduler and executor for
      every asynchronous thing the SFA platform does.

      Deploy with: docker compose -f docker-compose.inngest.yml up -d
      /opt/sfa-inngest/.env is written in full by the deploy workflow on every
      deploy - edit the GitHub Environment secrets, not the file on this box.

      !! THE DASHBOARD ON :8288 HAS NO AUTHENTICATION.
      Port 8288 serves the Event API, the REST/GraphQL API and the dashboard UI
      with no login of any kind. The DigitalOcean firewall is the ONLY thing
      keeping it off the public internet. Never open it, and never add nginx
      here to "make it easier to reach".

      To view the dashboard, tunnel from your machine:
        ssh -L 8288:localhost:8288 deploy@<this droplet>
      then open http://localhost:8288

      Run state lives in the `inngest_data` Docker volume (SQLite). Back it up;
      losing it loses scheduled-function state and run history.

runcmd:
  # FIRST, before anything slow or failure-prone. write_files created
  # /opt/sfa-inngest as root during cloud-init's init stage; until this line
  # runs, the deploy user cannot write to its own deploy target.
  #
  # This used to sit at the END of runcmd, behind apt and the Docker install.
  # A deploy that landed during those few minutes failed with
  # "tar: docker-compose.inngest.yml: Cannot open: Permission denied" - a race,
  # not a permissions bug, and one that re-running would appear to "fix".
  # Ordering it first shrinks the window to nothing.
  - install -d -o deploy -g deploy /opt/sfa-inngest
  - chown -R deploy:deploy /opt/sfa-inngest
  - export DEBIAN_FRONTEND=noninteractive
  - apt-get install -y ca-certificates curl gnupg ufw
  - install -m 0755 -d /etc/apt/keyrings
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  - chmod a+r /etc/apt/keyrings/docker.asc
  - echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
  - apt-get update
  - apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  - usermod -aG docker deploy
  # Host firewall as a second layer behind the DO firewall. 8288 is allowed only
  # from inside the VPC - the DO firewall narrows that further to the app
  # droplet specifically, but if that rule is ever loosened by accident this
  # still keeps the dashboard off the public internet.
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow OpenSSH
  - ufw allow from ${vpc_ip_range} to any port 8288 proto tcp
  - ufw --force enable
  - systemctl enable docker
  - systemctl start docker

final_message: "SFA Inngest droplet bootstrap complete"

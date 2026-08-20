#cloud-config
#
# Bootstrap for the Inngest droplet.
#
# A deliberately stripped-down sibling of cloud-init.yaml.tpl: same deploy user,
# same Docker install, but NO nginx, NO certbot and NO TLS script — this droplet
# serves nothing publicly. Its only inbound rules are SSH and port 8288 from the
# app droplet, both enforced by the DigitalOcean firewall.
#
# ⚠ This is a SEPARATE FILE rather than conditionals inside the app template on
# purpose. `user_data` cannot be changed in place: editing the app template
# REPLACES the running app droplet. Keeping the two apart means work on one can
# never destroy the other.
package_update: true
package_upgrade: true

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
      Self-hosted Inngest — the durable event bus, scheduler and executor for
      every asynchronous thing the SFA platform does.

      Deploy with: docker compose -f docker-compose.inngest.yml up -d
      /opt/sfa-inngest/.env is written in full by the deploy workflow on every
      deploy — edit the GitHub Environment secrets, not the file on this box.

      ⚠ THE DASHBOARD ON :8288 HAS NO AUTHENTICATION.
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
  - apt-get install -y ca-certificates curl gnupg ufw
  - install -m 0755 -d /etc/apt/keyrings
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  - chmod a+r /etc/apt/keyrings/docker.asc
  - echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
  - apt-get update
  - apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  - usermod -aG docker deploy
  - mkdir -p /opt/sfa-inngest
  - chown -R deploy:deploy /opt/sfa-inngest
  # Host firewall as a second layer behind the DO firewall. 8288 is allowed only
  # from inside the VPC — the DO firewall narrows that further to the app
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

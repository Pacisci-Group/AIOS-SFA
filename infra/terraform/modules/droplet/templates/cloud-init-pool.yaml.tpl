#cloud-config
#
# !! THIS FILE MUST BE PURE ASCII. NON-ASCII CHARACTERS BREAK THE WHOLE DROPLET.
#
# cloud-init parses this as YAML before applying any of it. One non-ASCII byte -
# an em dash in a comment is enough - fails the parse, and cloud-init then
# applies NOTHING: no deploy user, no Docker, no /opt directory. The droplet
# boots, sshd answers, and every symptom points somewhere else. CI fails the
# build on non-ASCII so it cannot recur.
#
# Autoscale pool member: edge + web + api + worker.
#
# ## Why this one configures itself
# Every other droplet in this repo is deployed to: CI copies a compose file over
# SSH and restarts it. A pool member cannot be. It may be created at any moment,
# by DigitalOcean rather than by us, long after the last deploy ran - there is
# nothing to SSH to at the moment it needs configuring, and nobody is watching.
#
# So the deploy publishes to a private Spaces bucket and every droplet pulls from
# it: once at boot, and every 30 seconds thereafter. One mechanism for the
# droplet created during a 3am traffic spike and the one that has been running
# for a month, which means they cannot drift apart.
#
# ## What is in user_data, and what that implies
# The bootstrap credential below is readable by anything on this droplet through
# the metadata service. It is deliberately READ-ONLY on a bucket holding nothing
# but deploy config: a compromised droplet cannot rewrite what every other
# droplet is about to fetch.
#
# ## !! Editing this file replaces every droplet in the pool
# `user_data` cannot be changed in place. Keep application concerns OUT of here -
# anything that changes per deploy belongs in the published config, which is
# precisely what this fetches. If you find yourself editing this to ship a
# change, it belongs in the bucket instead.
package_update: true

users:
  - name: deploy
    groups: sudo, docker
    shell: /bin/bash
    sudo: ["ALL=(ALL) NOPASSWD:ALL"]
    ssh_authorized_keys:
      - ${ssh_public_key}

write_files:
  # Credentials and location for the config bucket. Root-only.
  - path: /etc/sfa/bootstrap.env
    permissions: "0600"
    owner: root:root
    content: |
      AWS_ACCESS_KEY_ID=${config_access_key_id}
      AWS_SECRET_ACCESS_KEY=${config_secret_key}
      SFA_CONFIG_REGION=${config_region}
      SFA_CONFIG_HOST=${config_host}
      SFA_CONFIG_BUCKET=${config_bucket}

  # The convergence script. Idempotent, and safe to run every 30 seconds: it
  # does nothing at all unless the published config actually changed.
  - path: /usr/local/bin/sfa-converge
    permissions: "0755"
    owner: root:root
    content: |
      #!/usr/bin/env bash
      #
      # Fetch the published deploy config and apply it if it changed.
      #
      # Runs at boot and on a timer. The comparison is on content, not on time,
      # so a droplet that has been up for a month and one created a second ago
      # reach the same state by the same path.
      set -uo pipefail

      set -a
      . /etc/sfa/bootstrap.env
      set +a

      STAGE=$(mktemp -d)
      trap 'rm -rf "$STAGE"' EXIT

      # Fetched with curl's own SigV4 signing rather than the AWS CLI.
      #
      # awscli is NOT packaged for Ubuntu 24.04 - universe is enabled and there
      # is still no candidate - so `apt-get install awscli` fails and every
      # droplet in the pool would come up unable to fetch its configuration,
      # serving nothing, with the reason buried in a journal nobody reads.
      #
      # curl 8.5 ships in the base image and signs S3 requests natively, so
      # there is no package to install, no large download at boot, and nothing
      # to go missing.
      # Virtual-host addressing, using the bucket's own FQDN. That is how this
      # platform reaches Spaces everywhere else (STORAGE_FORCE_PATH_STYLE=false),
      # and taking the host from terraform rather than assembling one means
      # there is no second addressing style to get wrong.
      fetch() {
        curl -fsS --max-time 30 \
          --aws-sigv4 "aws:amz:$SFA_CONFIG_REGION:s3" \
          --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
          -o "$2" \
          "https://$SFA_CONFIG_HOST/current/$1"
      }

      if ! fetch docker-compose.prod.yml "$STAGE/docker-compose.prod.yml"; then
        echo "sfa-converge: no published compose file yet; nothing to do."
        exit 0
      fi
      if ! fetch app.env "$STAGE/.env"; then
        echo "sfa-converge: no published env yet; nothing to do."
        exit 0
      fi

      # Both files together decide the state, so the checksum covers both. A
      # change to either is a deploy.
      NEW=$(cat "$STAGE/docker-compose.prod.yml" "$STAGE/.env" | sha256sum | cut -d' ' -f1)
      OLD=$(cat /opt/sfa/.config-checksum 2>/dev/null || echo none)

      if [ "$NEW" = "$OLD" ]; then
        exit 0
      fi

      echo "sfa-converge: config changed ($OLD -> $NEW), applying."
      install -m 0644 -o deploy -g deploy "$STAGE/docker-compose.prod.yml" /opt/sfa/docker-compose.prod.yml
      install -m 0600 -o deploy -g deploy "$STAGE/.env" /opt/sfa/.env

      cd /opt/sfa

      # Registry login, if the published config carries credentials for it.
      GHCR_USER=$(grep -E '^GHCR_PULL_USER=' .env | cut -d= -f2- || true)
      GHCR_TOKEN=$(grep -E '^GHCR_PULL_TOKEN=' .env | cut -d= -f2- || true)
      if [ -n "$GHCR_USER" ] && [ -n "$GHCR_TOKEN" ]; then
        echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null 2>&1 || true
      fi

      # `--profile edge` because a pool member runs the whole new topology:
      # the TLS edge, the web container, the API, and the worker.
      if ! docker compose -f docker-compose.prod.yml --profile edge pull; then
        echo "sfa-converge: pull failed, leaving the running stack alone."
        exit 1
      fi
      if ! docker compose -f docker-compose.prod.yml --profile edge up -d --remove-orphans; then
        echo "sfa-converge: up failed, leaving the checksum unwritten so the next tick retries."
        exit 1
      fi

      # Written LAST, and only on success. A failed apply leaves the old
      # checksum, so the next tick tries again rather than believing it is done.
      echo "$NEW" > /opt/sfa/.config-checksum
      docker image prune -f >/dev/null 2>&1 || true
      echo "sfa-converge: applied."

  - path: /etc/systemd/system/sfa-converge.service
    permissions: "0644"
    content: |
      [Unit]
      Description=Apply the published SFA deploy config
      After=docker.service
      Requires=docker.service

      [Service]
      Type=oneshot
      ExecStart=/usr/local/bin/sfa-converge

  - path: /etc/systemd/system/sfa-converge.timer
    permissions: "0644"
    content: |
      [Unit]
      Description=Check for a new SFA deploy config

      [Timer]
      # Every 30 seconds. This IS the deploy latency for the whole pool, so it
      # is short; the check costs two small object reads and stops there when
      # nothing changed.
      OnBootSec=10s
      OnUnitActiveSec=30s
      AccuracySec=5s

      [Install]
      WantedBy=timers.target

  # A DigitalOcean REGIONAL_NETWORK (layer-4) load balancer forwards with the
  # client IP preserved and the DESTINATION still set to the balancer's own
  # address - direct server return. So a packet the worker LB forwards to us
  # arrives addressed to ${worker_lb_ip}, not to this droplet. Without a `local`
  # route for that address the kernel drops it as a martian: the balancer
  # forwards, we discard, nothing logs, the client times out after a full
  # timeout. This is the "configure backend Droplets for network load balancers"
  # step in DigitalOcean's docs, and it is what the whole worker/Inngest path
  # depends on. Missing it presents as async work silently not running while
  # every health check stays green.
  #
  # arp_announce=2 is the matching half: the kernel must answer ARP for the
  # balancer address on the VPC interface.
  - path: /etc/sysctl.d/99-sfa-nlb.conf
    permissions: "0644"
    content: |
      net.ipv4.conf.eth1.arp_announce = 2

  - path: /usr/local/bin/sfa-nlb-route
    permissions: "0755"
    content: |
      #!/usr/bin/env bash
      # Claim the internal load balancer address for direct server return.
      #
      # `replace` not `add`, and driven by a timer, because a systemd-networkd
      # restart - which happens during routine package updates - wipes the local
      # routing table. `replace` is idempotent, so re-asserting every 30s is
      # free when nothing changed and self-heals within one interval when it was.
      set -euo pipefail
      ip route replace to local ${worker_lb_ip} dev eth1
      sysctl -q -w net.ipv4.conf.eth1.arp_announce=2

  - path: /etc/systemd/system/sfa-nlb-route.service
    permissions: "0644"
    content: |
      [Unit]
      Description=Claim the internal load balancer address (network LB direct server return)
      After=network-online.target
      Wants=network-online.target

      [Service]
      Type=oneshot
      ExecStart=/usr/local/bin/sfa-nlb-route

  - path: /etc/systemd/system/sfa-nlb-route.timer
    permissions: "0644"
    content: |
      [Unit]
      Description=Re-assert the internal load balancer route (survives networkd restarts)

      [Timer]
      OnBootSec=5s
      OnUnitActiveSec=30s
      AccuracySec=5s

      [Install]
      WantedBy=timers.target

  - path: /opt/sfa/README.txt
    permissions: "0644"
    content: |
      SFA autoscale pool member.

      THIS DROPLET IS NOT DEPLOYED TO. It configures itself.

      /usr/local/bin/sfa-converge fetches the published config from the deploy
      bucket and applies it when it changes. It runs at boot and every 30s.

        systemctl status sfa-converge.timer
        journalctl -u sfa-converge -n 50
        /usr/local/bin/sfa-converge          # force a check now

      Do NOT hand-edit /opt/sfa/.env or docker-compose.prod.yml. The next tick
      overwrites both. Change the GitHub Environment and re-run the deploy.

      The edge terminates TLS on 80/443 and answers the load balancer's health
      check on 8081. Certificates come from MongoDB, not from this disk.

runcmd:
  # First, so a converge run cannot race an unwritable directory.
  - install -d -o deploy -g deploy /opt/sfa
  - install -d -o root -g root -m 0700 /etc/sfa
  - export DEBIAN_FRONTEND=noninteractive
  - apt-get install -y ca-certificates curl gnupg ufw
  # The config fetch depends on curl being able to sign S3 requests itself
  # (>= 7.75). Checked loudly, because without it every converge run fails and
  # the droplet serves nothing while looking perfectly healthy from outside.
  - ["bash", "-c", "curl --help all 2>/dev/null | grep -q aws-sigv4 || { echo 'FATAL: curl has no --aws-sigv4; this droplet cannot fetch its configuration'; exit 1; }"]
  - install -m 0755 -d /etc/apt/keyrings
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  - chmod a+r /etc/apt/keyrings/docker.asc
  - echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
  - apt-get update
  - apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  - usermod -aG docker deploy
  # Host firewall behind the DO firewall. 80 is NOT optional: ACME http-01
  # validation is a plain-HTTP request to the hostname being issued, so closing
  # it means no certificate is ever obtained. 8081 is the load balancer's health
  # check, which the DO firewall narrows to the balancer alone.
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow OpenSSH
  - ufw allow 80/tcp
  - ufw allow 443/tcp
  - ufw allow 8081/tcp
  - ufw allow 4001/tcp
  - ufw --force enable
  - systemctl enable docker
  - systemctl start docker
  - systemctl daemon-reload
  # Claim the load balancer address BEFORE converge, so the droplet can answer
  # forwarded traffic the moment the balancer's health check marks it healthy.
  - systemctl enable --now sfa-nlb-route.timer
  - ["bash", "-c", "/usr/local/bin/sfa-nlb-route || echo 'WARN: nlb route setup failed; the timer will retry'"]
  - systemctl enable --now sfa-converge.timer
  # Converge once synchronously, so the droplet is serving before it is ever
  # marked healthy - rather than waiting up to a timer interval while the load
  # balancer sends it traffic it cannot answer.
  - ["bash", "-c", "/usr/local/bin/sfa-converge || echo 'WARN: first converge failed; the timer will retry'"]

final_message: "SFA pool member ready (self-configuring, no Caddy)"

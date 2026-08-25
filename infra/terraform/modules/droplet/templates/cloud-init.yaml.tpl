#cloud-config
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
  - path: /etc/nginx/sites-available/sfa
    permissions: "0644"
    content: |
      server {
          listen 80 default_server;
          # server_name is baked from the environment's var.domain so it is set
          # automatically on every (re)build. The trailing "_" keeps this the
          # default vhost so plain-IP access still works before DNS/TLS exist.
          server_name ${domain} _;

          location / {
              proxy_pass http://127.0.0.1:8080;
              proxy_http_version 1.1;
              proxy_set_header Host $host;
              proxy_set_header X-Real-IP $remote_addr;
              proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
              proxy_set_header X-Forwarded-Proto $scheme;
          }
      }

  - path: /opt/sfa/enable-tls.sh
    permissions: "0755"
    content: |
      #!/usr/bin/env bash
      # Obtain/install a Let's Encrypt certificate for this environment's domain
      # and switch Nginx to HTTPS (with HTTP->HTTPS redirect). Idempotent and
      # safe to re-run. Requires that ${domain} already resolves to this droplet.
      set -euo pipefail
      DOMAIN="${domain}"
      EMAIL="${certbot_email}"
      if [ -z "$DOMAIN" ]; then
          echo "enable-tls: no domain configured; skipping."
          exit 0
      fi
      if [ -z "$EMAIL" ]; then
          echo "enable-tls: certbot_email not set; skipping. Set certbot_email in tfvars."
          exit 0
      fi
      certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

  - path: /opt/sfa/README.txt
    permissions: "0644"
    content: |
      SFA application directory.
      Deploy with: docker compose -f docker-compose.prod.yml up -d
      Place .env in /opt/sfa/.env before starting.
      Enable HTTPS (once DNS points here): sudo /opt/sfa/enable-tls.sh

runcmd:
  - apt-get install -y ca-certificates curl gnupg ufw nginx certbot python3-certbot-nginx
  - install -m 0755 -d /etc/apt/keyrings
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  - chmod a+r /etc/apt/keyrings/docker.asc
  - echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
  - apt-get update
  - apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  - usermod -aG docker deploy
  - mkdir -p /opt/sfa
  - chown -R deploy:deploy /opt/sfa
  - ln -sf /etc/nginx/sites-available/sfa /etc/nginx/sites-enabled/sfa
  - rm -f /etc/nginx/sites-enabled/default
  - nginx -t && systemctl reload nginx
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow OpenSSH
  - ufw allow 'Nginx Full'
  - ufw --force enable
  - systemctl enable docker nginx
  - systemctl start docker nginx
%{ if enable_tls ~}
  # Auto-issue TLS on boot (non-fatal). Exec-list form avoids YAML colon pitfalls.
  # If DNS is not pointing here yet, complete later with: sudo /opt/sfa/enable-tls.sh
  - ["bash", "-c", "/opt/sfa/enable-tls.sh || echo 'enable-tls skipped or failed; run sudo /opt/sfa/enable-tls.sh once DNS resolves'"]
%{ endif ~}

final_message: "SFA droplet bootstrap complete for ${domain}"

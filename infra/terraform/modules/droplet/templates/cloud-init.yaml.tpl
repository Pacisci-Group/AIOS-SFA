#cloud-config
# Edge server: Caddy, not Nginx.
#
# ## Why Caddy
# White-labelling lets any agency point their own domain at this droplet, and
# every one of those hostnames needs its own TLS certificate. Certbot cannot do
# that without a person (or a cron job) running it per domain, which puts a
# manual step between "agency adds a domain" and "the domain works".
#
# Caddy's **on-demand TLS** obtains a certificate at first request for a host it
# has never seen - but only after asking the API whether that host is one we
# actually serve (`/public/domains/allow`). Without that gate a public IP on
# port 443 lets anyone make us request certificates for arbitrary names until
# Let's Encrypt rate-limits the whole account, so the `ask` directive is not
# optional.
#
# ## !! Changing this file replaces the droplet
# `user_data` cannot be edited in place. Any change here - including switching
# an existing Nginx droplet to this - destroys and recreates the instance. Plan
# it, do it on `dev` first, and expect to re-run the seed. See DEPLOYMENT.md.
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
  - path: /etc/caddy/Caddyfile
    permissions: "0644"
    content: |
      {
          email ${certbot_email}

          # Caddy asks this before issuing a certificate for an unknown host.
          # A 200 means "we serve that name"; anything else refuses the
          # connection. It talks to the API directly on loopback rather than
          # through this same proxy, so a certificate problem cannot make the
          # gate itself unreachable and wedge every new domain.
          on_demand_tls {
              ask http://127.0.0.1:4000/api/v1/public/domains/allow
              interval 2m
              burst 5
          }
      }

      # The platform host and every agency subdomain, on one wildcard
      # certificate.
      #
      # !! A wildcard requires the **DNS-01** challenge, which needs a Caddy
      # build carrying the DNS plugin for the zone's provider and an API token
      # for it. Neither is installed here, so this block is commented out and
      # subdomains fall through to on-demand TLS below - which works, at the
      # cost of a one-request latency spike the first time each new subdomain is
      # visited. Uncomment once a plugin build is in place:
      #
      #   ${domain}, *.{$BASE_DOMAIN} {
      #       tls { dns <provider> {env.DNS_API_TOKEN} }
      #       reverse_proxy 127.0.0.1:8080
      #   }

      # Bare-IP access over plain HTTP. Kept because the deploy workflow's
      # health check runs against http://<droplet_ip>/api/v1/health, which has
      # to work before any DNS record exists - and an IP can never have a
      # certificate, so it must not be redirected to HTTPS.
      http://{$DROPLET_IP} {
          reverse_proxy 127.0.0.1:8080
      }

      # Any other plain-HTTP request: send it to HTTPS. Caddy answers the ACME
      # HTTP-01 challenge on this listener itself, ahead of this redirect, so
      # certificate issuance still works.
      http:// {
          redir https://{host}{uri} permanent
      }

      # Everything over HTTPS: the platform host, agency subdomains, and agency
      # custom domains. Certificates are issued on demand, gated by `ask` above.
      #
      # `Host` is passed through untouched (Caddy's default for reverse_proxy),
      # which is what lets the API resolve the tenant from it. Do NOT add a
      # `header_up Host` override here - it would make every request look like
      # it arrived on one hostname and collapse every tenant into one.
      https:// {
          tls {
              on_demand
          }
          reverse_proxy 127.0.0.1:8080
      }

  - path: /opt/sfa/README.txt
    permissions: "0644"
    content: |
      SFA application directory.
      Deploy with: docker compose -f docker-compose.prod.yml up -d
      Place .env in /opt/sfa/.env before starting.

      TLS is automatic - Caddy obtains a certificate the first time each
      hostname is requested, after checking it against the API's
      /public/domains/allow gate. There is no enable-tls.sh any more.

      If a tenant reports their domain does not work, check in this order:
        1. curl -sI "http://127.0.0.1:4000/api/v1/public/domains/allow?domain=<host>"
           -> must be 200. If not, the domain is not `active` in the app.
        2. journalctl -u caddy -n 100
        3. dig +short <host>   -> must resolve to this droplet.

runcmd:
  - apt-get install -y ca-certificates curl gnupg ufw debian-keyring debian-archive-keyring apt-transport-https
  # Caddy's own apt repository - the Ubuntu archive's package is far behind and
  # predates several on-demand TLS fixes.
  - curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  - curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  - install -m 0755 -d /etc/apt/keyrings
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  - chmod a+r /etc/apt/keyrings/docker.asc
  - echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
  - apt-get update
  - apt-get install -y caddy docker-ce docker-ce-cli containerd.io docker-compose-plugin
  - usermod -aG docker deploy
  - mkdir -p /opt/sfa
  - chown -R deploy:deploy /opt/sfa
  # The Caddyfile reads {$DROPLET_IP} from the environment. Taken from the
  # instance's own metadata rather than hard-coded at plan time, so the bare-IP
  # block stays correct on a rebuild that lands on a different address before
  # the reserved IP is attached.
  #
  # BASE_DOMAIN is deliberately NOT set here. It is referenced only by the
  # commented-out wildcard block, and `var.domain` is the full platform host
  # (`dev.example.com`), not the parent zone - setting it from that would put a
  # plausible-looking wrong value in the environment for whoever uncomments it.
  # Add it explicitly, alongside the DNS plugin token, at that point.
  - ["bash", "-c", "mkdir -p /etc/systemd/system/caddy.service.d && printf '[Service]\\nEnvironment=DROPLET_IP=%s\\n' \"$(curl -s --max-time 5 http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address || echo 0.0.0.0)\" > /etc/systemd/system/caddy.service.d/override.conf"]
  - systemctl daemon-reload
  - caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow OpenSSH
  - ufw allow 80/tcp
  - ufw allow 443/tcp
  - ufw --force enable
  - systemctl enable docker caddy
  - systemctl start docker
  - systemctl restart caddy

final_message: "SFA droplet bootstrap complete for ${domain}"

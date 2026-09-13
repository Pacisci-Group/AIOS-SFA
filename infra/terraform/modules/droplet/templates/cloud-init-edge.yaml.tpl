#cloud-config
#
# !! THIS FILE MUST BE PURE ASCII. NON-ASCII CHARACTERS BREAK THE WHOLE DROPLET.
#
# cloud-init parses this as YAML before applying any of it. A single non-ASCII
# byte - an em dash in a comment is enough - fails the parse, and cloud-init
# then applies NOTHING: no deploy user, no Docker, no /opt directory. The
# droplet boots, sshd answers, and every subsequent symptom points somewhere
# else entirely. `ci-terraform-templates` in .github/workflows fails the build
# on non-ASCII so it cannot recur. See cloud-init-inngest.yaml.tpl, where it
# cost a day.
#
# App droplet WITHOUT Caddy - the edge is our own Node TLS terminator, shipped
# as a container by the deploy.
#
# ## Why there is no web server here at all
# Caddy held certificates on local disk. That is the one piece of genuinely
# node-local state in the white-label design, and it is what stops the app tier
# from scaling: each node would run its own ACME client and race the others for
# the same hostnames, which Let's Encrypt counts against a duplicate-certificate
# limit.
#
# The Node edge reads certificates from MongoDB instead, so a droplet that
# joined the pool thirty seconds ago can serve a tenant domain added minutes ago
# without having issued anything. Nothing about TLS is installed on the host any
# more - it arrives with the image, and is configured by /opt/sfa/.env like
# every other service.
#
# ## !! Selecting this template REPLACES the droplet
# `user_data` cannot be edited in place, so switching an environment between
# this and cloud-init.yaml.tpl destroys and recreates its app droplet. That is
# why the two are separate files chosen by `enable_node_edge` rather than one
# file with a conditional: an edit to the file production uses would replace
# production. Do it on dev first and expect to re-run the seed.
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
  - path: /opt/sfa/README.txt
    permissions: "0644"
    content: |
      SFA application directory.
      Deploy with: docker compose -f docker-compose.prod.yml up -d
      Place .env in /opt/sfa/.env before starting.

      THE EDGE IS A CONTAINER, NOT A HOST SERVICE.
      There is no Caddy, no nginx and no certbot on this box. The `edge`
      service in docker-compose.prod.yml terminates TLS on ports 80 and 443,
      looks certificates up in MongoDB by SNI, and proxies to the `web`
      container. Certificates are obtained and renewed by the worker.

      If a tenant reports their domain does not work, check in this order:
        1. docker compose -f docker-compose.prod.yml logs --tail=100 edge
           -> a refused handshake names the hostname it had no certificate for.
        2. Is there a row?  mongosh "$MONGODB_URI" --eval \
             'db.certificates.findOne({hostname:"<host>"},{certPem:0,keyPemEncrypted:0})'
           status must be "active". "failed" carries lastError.
        3. dig +short <host>   -> must resolve to this droplet.

      Certificate issuance needs ACME_ENABLED=true in /opt/sfa/.env. With it
      false the edge still serves whatever certificates already exist, and
      obtains no new ones.

runcmd:
  # FIRST, before anything slow or failure-prone. A deploy that lands while apt
  # is still running would otherwise fail on an unwritable /opt/sfa - a race,
  # not a permissions bug, and one that re-running appears to "fix". Same
  # ordering fix as the Inngest template.
  - install -d -o deploy -g deploy /opt/sfa
  - chown -R deploy:deploy /opt/sfa
  - export DEBIAN_FRONTEND=noninteractive
  - apt-get install -y ca-certificates curl gnupg ufw
  - install -m 0755 -d /etc/apt/keyrings
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  - chmod a+r /etc/apt/keyrings/docker.asc
  - echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
  - apt-get update
  - apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  - usermod -aG docker deploy
  # Host firewall as a second layer behind the DO firewall. 80 is NOT optional:
  # ACME http-01 validation is a plain-HTTP request to the hostname being
  # issued, so closing it means no certificate is ever obtained - and the only
  # symptom is domains that never start working.
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow OpenSSH
  - ufw allow 80/tcp
  - ufw allow 443/tcp
  - ufw --force enable
  - systemctl enable docker
  - systemctl start docker

final_message: "SFA droplet bootstrap complete for ${domain} (Node edge, no Caddy)"

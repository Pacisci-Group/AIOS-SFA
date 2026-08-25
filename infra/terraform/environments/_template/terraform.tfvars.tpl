# Copy to terraform.tfvars and fill in values before apply.
# Or use: cp ../../presets/<env>.tfvars terraform.tfvars

environment     = "{{ENV}}"
region          = "nyc3"
spaces_region   = "nyc3"
droplet_size    = "s-1vcpu-2gb"
mongo_size      = "db-s-1vcpu-1gb"
mongo_node_count = 1

domain_root     = "example.com"       # Your domain zone in DigitalOcean DNS
dns_subdomain   = "{{ENV}}"
domain          = "{{ENV}}.example.com"

# nginx server_name is baked from `domain` automatically. Set certbot_email and run
# `sudo /opt/sfa/enable-tls.sh` once DNS resolves, or set enable_tls = true (best
# with a reserved IP) to auto-issue TLS on first boot / rebuilds.
enable_tls      = false
certbot_email   = ""

ssh_public_key  = "ssh-ed25519 AAAA... your-key"  # REQUIRED
ssh_allowed_ips = ["YOUR.IP.ADDRESS/32"]          # REQUIRED

enable_dns          = true
create_domain_zone  = false   # true only if domain is not yet in DO
enable_reserved_ip  = false

# Object storage for document uploads (deal-audit attachments, lead intake).
# Applying this also needs SPACES_ACCESS_KEY_ID / SPACES_SECRET_ACCESS_KEY
# exported — Spaces buckets are managed over the S3 API, not the DO API.
enable_spaces       = true
enable_backups      = false

# Origins allowed to run presigned browser uploads. Empty derives them from
# `domain`/`enable_tls` plus the droplet's public IP.
spaces_cors_origins = []

prevent_destroy     = false
project_id          = ""

tags = ["sfa", "{{ENV}}"]

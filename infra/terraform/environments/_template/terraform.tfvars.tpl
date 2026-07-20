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
enable_spaces       = false
enable_backups      = false
prevent_destroy     = false
project_id          = ""

tags = ["sfa", "{{ENV}}"]

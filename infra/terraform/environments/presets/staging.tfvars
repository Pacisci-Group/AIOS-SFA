environment      = "staging"
region           = "nyc3"
spaces_region    = "nyc3"
droplet_size     = "s-2vcpu-4gb"
mongo_size       = "db-s-1vcpu-2gb"
mongo_node_count = 1

domain_root   = "example.com"
dns_subdomain = "staging"
domain        = "staging.example.com"

# nginx server_name is baked from `domain` on every build. Set certbot_email and
# run `sudo /opt/sfa/enable-tls.sh` once DNS points here (or set enable_tls = true
# with a reserved IP so first-boot Certbot works automatically on rebuilds).
enable_tls    = false
certbot_email = ""

ssh_public_key  = "ssh-ed25519 CHANGE_ME"
ssh_allowed_ips = ["0.0.0.0/0"]

enable_dns         = true
create_domain_zone = false
enable_reserved_ip = false

# Object storage is required, not optional: the deal-audit and lead-intake flows
# upload documents through presigned URLs. Applying this needs
# SPACES_ACCESS_KEY_ID / SPACES_SECRET_ACCESS_KEY exported alongside
# DIGITALOCEAN_TOKEN — buckets are managed over the S3 API, not the DO API.
enable_spaces  = true
enable_backups = false

# Empty = derive a single origin from `domain` + `enable_tls`. The derived value
# follows enable_tls, so flipping TLS on rewrites the rule correctly — but pin
# the real origin here once the hostname is final.
spaces_cors_origins = []

prevent_destroy = false
project_id      = ""

tags = ["sfa", "staging"]

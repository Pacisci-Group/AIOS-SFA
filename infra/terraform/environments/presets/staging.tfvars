environment      = "staging"
region           = "nyc3"
spaces_region    = "nyc3"
droplet_size     = "s-2vcpu-4gb"
mongo_size       = "db-s-1vcpu-2gb"
mongo_node_count = 1
# Permission cache + notification pub/sub (PAC-154). Nothing durable lives in it.
redis_size = "db-s-1vcpu-1gb"

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
enable_spaces = true

# Weekly MongoDB snapshots (PAC-172): a private sfa-<env>-db-backups bucket and
# the worker's key for it. Provisioning alone takes no snapshot - the worker
# runs only where DB_BACKUP_ENABLED is true in the GitHub Environment. Applying
# needs the SPACES_* pair exported, exactly like enable_spaces.
enable_db_backups = true

# Empty = derive a single origin from `domain` + `enable_tls`. The derived value
# follows enable_tls, so flipping TLS on rewrites the rule correctly — but pin
# the real origin here once the hostname is final.
spaces_cors_origins = []

prevent_destroy = false
project_id      = ""

tags = ["sfa", "staging"]

environment      = "dev"
region           = "nyc3"
spaces_region    = "nyc3"
droplet_size     = "s-1vcpu-2gb"
mongo_size       = "db-s-1vcpu-1gb"
mongo_node_count = 1

# dev is live at https://dev.smithfamily.agency (droplet 174.138.117.56).
# The zone is hosted at GoDaddy, not DigitalOcean, so the A record is managed
# by hand there and enable_dns stays false — the dns module would otherwise try
# to create a DO zone we do not own. domain_root/dns_subdomain are unused while
# enable_dns = false, but are kept accurate for the day the zone moves to DO.
domain_root   = "smithfamily.agency"
dns_subdomain = "dev"
domain        = "dev.smithfamily.agency"

# ⚠ enable_tls, certbot_email and ssh_public_key are interpolated into the
# droplet's cloud-init `user_data`, which DigitalOcean cannot change in place —
# a mismatch against what was originally applied REPLACES THE RUNNING DROPLET.
# The values below are the ones dev was actually built with. Do not "tidy" them
# back to placeholders; that is what makes a plan propose a rebuild.
enable_tls    = true
certbot_email = "awaris@paciscigroup.com"

# Public half of the deploy keypair — not a secret. The matching private key is
# the SSH_KEY secret in the dev GitHub Environment.
ssh_public_key  = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAID9HpO5tEmSVovHJ3camJKdM+MT0OWvFz3UPAoOnPs/R sfa-deploy"
ssh_allowed_ips = ["0.0.0.0/0"] # TODO: narrow to known IPs — SSH is open to the internet

enable_dns         = false
create_domain_zone = false
enable_reserved_ip = true

# Object storage is required, not optional: the deal-audit and lead-intake flows
# upload documents through presigned URLs. Applying this needs
# SPACES_ACCESS_KEY_ID / SPACES_SECRET_ACCESS_KEY exported alongside
# DIGITALOCEAN_TOKEN — buckets are managed over the S3 API, not the DO API.
enable_spaces  = true
enable_backups = false

# Browser origins allowed to run presigned uploads. Pinned rather than derived:
# the derivation keys off `enable_tls`, which is false here even though dev is
# actually served over HTTPS (Certbot was run on the droplet, not by Terraform),
# so the derived value would be http:// and every upload preflight would fail.
spaces_cors_origins = ["https://dev.smithfamily.agency"]

prevent_destroy = false
project_id      = ""

tags = ["sfa", "dev"]

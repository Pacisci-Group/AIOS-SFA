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
enable_spaces      = false
enable_backups     = false
prevent_destroy    = false
project_id         = ""

tags = ["sfa", "staging"]

environment      = "dev"
region           = "nyc3"
spaces_region    = "nyc3"
droplet_size     = "s-1vcpu-2gb"
mongo_size       = "db-s-1vcpu-1gb"
mongo_node_count = 1

# DNS is deferred for dev — access the app via the droplet IP for now.
# When ready: add the domain to DO DNS, set real values, flip enable_dns = true.
domain_root   = "example.com"
dns_subdomain = "dev"
domain        = "dev.example.com"

# REQUIRED — set before apply (or override in terraform.tfvars)
ssh_public_key  = "ssh-ed25519 CHANGE_ME"
ssh_allowed_ips = ["0.0.0.0/0"] # Replace with your IP/32 before production use

enable_dns         = false
create_domain_zone = false
enable_reserved_ip = false
enable_spaces      = false
enable_backups     = false
prevent_destroy    = false
project_id         = ""

tags = ["sfa", "dev"]

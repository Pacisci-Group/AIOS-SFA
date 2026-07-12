environment      = "production"
region           = "nyc3"
spaces_region    = "nyc3"
droplet_size     = "s-2vcpu-4gb"
mongo_size       = "db-s-2vcpu-4gb"
mongo_node_count = 1

domain_root   = "example.com"
dns_subdomain = "app"
domain        = "app.example.com"

ssh_public_key  = "ssh-ed25519 CHANGE_ME"
ssh_allowed_ips = ["0.0.0.0/0"]

enable_dns         = true
create_domain_zone = false
enable_reserved_ip = true
enable_spaces      = true
enable_backups     = true
prevent_destroy    = true
project_id         = ""

tags = ["sfa", "production"]

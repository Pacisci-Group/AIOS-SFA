resource "digitalocean_droplet" "this" {
  name     = var.name
  region   = var.region
  size     = var.size
  image    = "ubuntu-24-04-x64"
  vpc_uuid = var.vpc_uuid

  ssh_keys          = var.ssh_key_fingerprints
  monitoring        = var.enable_monitoring
  ipv6              = false
  user_data         = var.user_data
  tags              = var.tags
  graceful_shutdown = true
}

resource "digitalocean_reserved_ip" "this" {
  count  = var.enable_reserved_ip ? 1 : 0
  region = var.region
}

resource "digitalocean_reserved_ip_assignment" "this" {
  count      = var.enable_reserved_ip ? 1 : 0
  ip_address = digitalocean_reserved_ip.this[0].ip_address
  droplet_id = digitalocean_droplet.this.id
}

output "id" {
  description = "Droplet ID"
  value       = digitalocean_droplet.this.id
}

output "urn" {
  description = "Droplet URN"
  value       = digitalocean_droplet.this.urn
}

output "ipv4_address" {
  description = "Public IPv4 address"
  value       = digitalocean_droplet.this.ipv4_address
}

output "ipv4_address_private" {
  description = "Private IPv4 address in VPC"
  value       = digitalocean_droplet.this.ipv4_address_private
}

output "reserved_ip" {
  description = "Reserved IP if enabled"
  value       = var.enable_reserved_ip ? digitalocean_reserved_ip.this[0].ip_address : null
}

output "public_ip" {
  description = "Best public IP (reserved if enabled, else droplet IP)"
  value       = var.enable_reserved_ip ? digitalocean_reserved_ip.this[0].ip_address : digitalocean_droplet.this.ipv4_address
}

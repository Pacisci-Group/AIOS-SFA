output "id" {
  value = digitalocean_loadbalancer.this.id
}

output "urn" {
  value = digitalocean_loadbalancer.this.urn
}

output "ip" {
  description = <<-EOT
    The balancer's address.

    For an EXTERNAL balancer this is the public address DNS points at, and the
    one agencies put in an A record. For an INTERNAL one it is the VPC address,
    which is what reaches it from inside the network.
  EOT
  value       = digitalocean_loadbalancer.this.ip
}

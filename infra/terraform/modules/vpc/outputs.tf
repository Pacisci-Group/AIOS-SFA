output "id" {
  description = "VPC UUID"
  value       = digitalocean_vpc.this.id
}

output "urn" {
  description = "VPC URN"
  value       = digitalocean_vpc.this.urn
}

output "ip_range" {
  description = "VPC CIDR. Resolved from the resource rather than the variable so it reflects the range DigitalOcean actually assigned."
  value       = digitalocean_vpc.this.ip_range
}

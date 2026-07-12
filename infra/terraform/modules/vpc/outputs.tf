output "id" {
  description = "VPC UUID"
  value       = digitalocean_vpc.this.id
}

output "urn" {
  description = "VPC URN"
  value       = digitalocean_vpc.this.urn
}

output "cluster_id" {
  description = "Valkey cluster ID"
  value       = digitalocean_database_cluster.this.id
}

output "host" {
  description = "Valkey public host (TLS, firewall-gated)"
  value       = digitalocean_database_cluster.this.host
}

output "private_host" {
  description = "Valkey VPC host"
  value       = digitalocean_database_cluster.this.private_host
}

output "port" {
  description = "Valkey port"
  value       = digitalocean_database_cluster.this.port
}

# The value REDIS_URL carries: `rediss://` (TLS) on the VPC host. The droplets
# share the VPC, so this never leaves the private network, and the firewall
# above still applies. Carries the default user's password — sensitive.
output "connection_uri" {
  description = "Full Valkey connection URI over the VPC, for REDIS_URL"
  value       = digitalocean_database_cluster.this.private_uri
  sensitive   = true
}

# The same over the public host. For a developer reaching the cluster from an
# allow-listed IP (`allowed_ip_addresses`); the app should use the private one.
output "public_connection_uri" {
  description = "Full Valkey connection URI over the public host (TLS)"
  value       = digitalocean_database_cluster.this.uri
  sensitive   = true
}

output "cluster_urn" {
  description = "Valkey cluster URN"
  value       = digitalocean_database_cluster.this.urn
}

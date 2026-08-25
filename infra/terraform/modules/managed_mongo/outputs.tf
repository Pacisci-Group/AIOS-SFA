locals {
  mongodb_uri = "mongodb+srv://${digitalocean_database_user.app.name}:${digitalocean_database_user.app.password}@${digitalocean_database_cluster.this.host}/${digitalocean_database_db.app.name}?tls=true&authSource=admin&retryWrites=true&w=majority"
}

output "cluster_id" {
  description = "MongoDB cluster ID"
  value       = digitalocean_database_cluster.this.id
}

output "host" {
  description = "MongoDB host"
  value       = digitalocean_database_cluster.this.host
}

output "port" {
  description = "MongoDB port"
  value       = digitalocean_database_cluster.this.port
}

output "database_name" {
  description = "Application database name"
  value       = digitalocean_database_db.app.name
}

output "db_user" {
  description = "Application database user"
  value       = digitalocean_database_user.app.name
}

output "db_password" {
  description = "Application database user password"
  value       = digitalocean_database_user.app.password
  sensitive   = true
}

output "connection_uri" {
  description = "Full MongoDB connection URI for the application"
  value       = local.mongodb_uri
  sensitive   = true
}

output "cluster_urn" {
  description = "MongoDB cluster URN"
  value       = digitalocean_database_cluster.this.urn
}

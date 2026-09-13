output "bucket" {
  value = digitalocean_spaces_bucket.config.name
}

output "endpoint" {
  value = digitalocean_spaces_bucket.config.endpoint
}

output "region" {
  value = var.region
}

output "bootstrap_access_key_id" {
  description = "Read-only key baked into droplet user_data."
  value       = digitalocean_spaces_key.bootstrap.access_key
}

output "bootstrap_secret_key" {
  value     = digitalocean_spaces_key.bootstrap.secret_key
  sensitive = true
}

output "publish_access_key_id" {
  description = "Read/write key for CI. DEPLOY_CONFIG_ACCESS_KEY_ID."
  value       = digitalocean_spaces_key.publish.access_key
}

output "publish_secret_key" {
  value     = digitalocean_spaces_key.publish.secret_key
  sensitive = true
}

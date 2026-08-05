output "name" {
  description = "Bucket name"
  value       = digitalocean_spaces_bucket.this.name
}

output "region" {
  description = "Bucket region"
  value       = digitalocean_spaces_bucket.this.region
}

output "bucket_domain_name" {
  description = "Bucket domain name"
  value       = digitalocean_spaces_bucket.this.bucket_domain_name
}

output "endpoint" {
  description = "Spaces endpoint URL (STORAGE_ENDPOINT)"
  value       = "https://${var.region}.digitaloceanspaces.com"
}

output "urn" {
  description = "Spaces bucket URN"
  value       = digitalocean_spaces_bucket.this.urn
}

output "access_key_id" {
  description = "Bucket-scoped Spaces access key ID (STORAGE_ACCESS_KEY_ID)"
  value       = var.create_access_key ? digitalocean_spaces_key.app[0].access_key : null
}

output "secret_access_key" {
  description = "Bucket-scoped Spaces secret (STORAGE_SECRET_ACCESS_KEY)"
  value       = var.create_access_key ? digitalocean_spaces_key.app[0].secret_key : null
  sensitive   = true
}

output "cors_allowed_origins" {
  description = "Origins allowed to upload/download from a browser"
  value       = var.cors_allowed_origins
}

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
  description = "Spaces endpoint URL"
  value       = "https://${var.region}.digitaloceanspaces.com"
}

output "urn" {
  description = "Spaces bucket URN"
  value       = digitalocean_spaces_bucket.this.urn
}

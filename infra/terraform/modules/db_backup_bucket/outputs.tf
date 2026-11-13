output "bucket" {
  description = "Bucket name (DB_BACKUP_STORAGE_BUCKET)."
  value       = digitalocean_spaces_bucket.backups.name
}

output "endpoint" {
  description = <<-EOT
    Region endpoint URL (DB_BACKUP_STORAGE_ENDPOINT).

    Built with the scheme rather than passed through from the provider, whose
    `endpoint` attribute is a bare host. Matches how `modules/spaces` produces
    STORAGE_ENDPOINT and `modules/deploy_config` its endpoint.
  EOT
  value       = "https://${var.region}.digitaloceanspaces.com"
}

output "region" {
  description = "Bucket region (DB_BACKUP_STORAGE_REGION)."
  value       = var.region
}

output "bucket_domain_name" {
  value = digitalocean_spaces_bucket.backups.bucket_domain_name
}

output "urn" {
  value = digitalocean_spaces_bucket.backups.urn
}

output "access_key_id" {
  description = "Bucket-scoped key ID for the worker (DB_BACKUP_STORAGE_ACCESS_KEY_ID)."
  value       = digitalocean_spaces_key.worker.access_key
}

output "secret_key" {
  description = "Bucket-scoped secret for the worker (DB_BACKUP_STORAGE_SECRET_ACCESS_KEY)."
  value       = digitalocean_spaces_key.worker.secret_key
  sensitive   = true
}

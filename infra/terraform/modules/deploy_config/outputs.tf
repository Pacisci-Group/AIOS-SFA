output "bucket" {
  value = digitalocean_spaces_bucket.config.name
}

output "endpoint" {
  description = <<-EOT
    Region endpoint URL, for tooling that takes --endpoint-url.

    Built with the scheme rather than passed through from the provider, whose
    `endpoint` attribute is a bare host — `aws s3 cp --endpoint-url` rejects
    that. Matches how `modules/spaces` produces STORAGE_ENDPOINT.
  EOT
  value       = "https://${var.region}.digitaloceanspaces.com"
}

output "bucket_domain_name" {
  description = <<-EOT
    The bucket's own FQDN — `<bucket>.<region>.digitaloceanspaces.com`.

    Handed to droplets so the fetch URL needs no string assembly. It is also
    virtual-host addressing, which is how this platform already reaches Spaces
    everywhere else (`STORAGE_FORCE_PATH_STYLE=false`); building a path-style
    URL by hand would be a second addressing style to be wrong about.
  EOT
  value       = digitalocean_spaces_bucket.config.bucket_domain_name
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

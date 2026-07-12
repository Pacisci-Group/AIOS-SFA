output "state_bucket_name" {
  description = "Terraform remote state bucket"
  value       = digitalocean_spaces_bucket.state.name
}

output "state_bucket_region" {
  description = "Terraform remote state bucket region"
  value       = digitalocean_spaces_bucket.state.region
}

output "backend_hint" {
  description = "Values to plug into environment backend.tf"
  value       = <<-EOT
    bucket = "${digitalocean_spaces_bucket.state.name}"
    endpoint = "https://${digitalocean_spaces_bucket.state.region}.digitaloceanspaces.com"
  EOT
}

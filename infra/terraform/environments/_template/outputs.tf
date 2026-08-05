output "environment" {
  value = module.sfa.environment
}

output "droplet_ip" {
  value = module.sfa.droplet_ip
}

output "domain" {
  value = module.sfa.domain
}

output "fqdn" {
  value = module.sfa.fqdn
}

output "mongodb_uri" {
  value     = module.sfa.mongodb_uri
  sensitive = true
}

output "spaces_bucket" {
  value = module.sfa.spaces_bucket
}

output "spaces_endpoint" {
  value = module.sfa.spaces_endpoint
}

output "spaces_region" {
  value = module.sfa.spaces_region
}

output "spaces_access_key_id" {
  value = module.sfa.spaces_access_key_id
}

output "spaces_secret_access_key" {
  value     = module.sfa.spaces_secret_access_key
  sensitive = true
}

output "spaces_cors_origins" {
  value = module.sfa.spaces_cors_origins
}

output "ssh_command" {
  value = module.sfa.ssh_command
}

output "deploy_notes" {
  value = module.sfa.deploy_notes
}

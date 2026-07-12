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

output "ssh_command" {
  value = module.sfa.ssh_command
}

output "deploy_notes" {
  value = module.sfa.deploy_notes
}

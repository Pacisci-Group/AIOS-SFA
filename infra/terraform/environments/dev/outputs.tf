output "environment" {
  value = module.sfa.environment
}

output "droplet_ip" {
  value = module.sfa.droplet_ip
}

output "droplet_private_ip" {
  description = "App droplet VPC address. This is APP_PRIVATE_IP — a bare address, no port."
  value       = module.sfa.droplet_private_ip
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

# ─── Inngest ──────────────────────────────────────────────────────────────────
# `terraform output` only ever shows outputs declared in THIS root module, so
# anything added to stacks/sfa must be re-exported here or it is invisible.

output "inngest_droplet_ip" {
  description = "INNGEST_SSH_HOST. Also how you tunnel the dashboard: ssh -L 8288:localhost:8288 deploy@<ip>"
  value       = module.sfa.inngest_droplet_ip
}

output "inngest_droplet_private_ip" {
  description = "VPC address of the Inngest droplet."
  value       = module.sfa.inngest_droplet_private_ip
}

# The one to actually use — all three infrastructure-derived secrets, labelled:
#   terraform output inngest_github_secrets
output "inngest_github_secrets" {
  description = "Inngest GitHub Environment secrets derived from infrastructure. Null until enable_inngest = true has been applied."
  value       = module.sfa.inngest_github_secrets
}

# ─── Autoscale pool ───────────────────────────────────────────────────────────
#
# ⚠ An environment surfaces only the stack outputs it names here. A new stack
# output is invisible from `terraform output` until it is added, which is how
# the deploy-config values went missing after the first apply.

output "public_ip" {
  description = "The address to point DNS at: the load balancer with a pool, the reserved IP without one."
  value       = module.sfa.public_ip
}

output "worker_endpoint" {
  description = "APP_PRIVATE_IP. The internal balancer with a pool, which survives scaling; a member's own address does not."
  value       = module.sfa.worker_endpoint
}

output "pool_id" {
  value = module.sfa.pool_id
}

output "deploy_config_github_secrets" {
  description = "DEPLOY_CONFIG_* Environment secrets, minus the secret key below."
  value       = module.sfa.deploy_config_github_secrets
}

output "deploy_config_secret_key" {
  description = "DEPLOY_CONFIG_SECRET_ACCESS_KEY. CI only — droplets hold a separate read-only key baked into user_data."
  value       = module.sfa.deploy_config_secret_key
  sensitive   = true
}

output "environment" {
  value = var.environment
}

output "region" {
  value = var.region
}

output "droplet_id" {
  value = module.droplet.id
}

output "droplet_ip" {
  description = "Public IP for SSH and DNS"
  value       = module.droplet.public_ip
}

output "droplet_private_ip" {
  value = module.droplet.ipv4_address_private
}

output "firewall_id" {
  value = module.firewall.id
}

output "domain" {
  value = var.domain
}

output "fqdn" {
  value = var.enable_dns ? module.dns[0].fqdn : var.domain
}

output "mongodb_uri" {
  description = "Application MongoDB connection string"
  value       = module.mongo.connection_uri
  sensitive   = true
}

output "mongodb_host" {
  value = module.mongo.host
}

output "spaces_bucket" {
  description = "Object storage bucket name (STORAGE_BUCKET)"
  value       = var.enable_spaces ? module.spaces[0].name : null
}

output "spaces_endpoint" {
  description = "Object storage endpoint (STORAGE_ENDPOINT)"
  value       = var.enable_spaces ? module.spaces[0].endpoint : null
}

output "spaces_region" {
  description = "Object storage region (STORAGE_REGION)"
  value       = var.enable_spaces ? module.spaces[0].region : null
}

output "spaces_access_key_id" {
  description = "Bucket-scoped access key ID (STORAGE_ACCESS_KEY_ID)"
  value       = var.enable_spaces ? module.spaces[0].access_key_id : null
}

output "spaces_secret_access_key" {
  description = "Bucket-scoped secret (STORAGE_SECRET_ACCESS_KEY)"
  value       = var.enable_spaces ? module.spaces[0].secret_access_key : null
  sensitive   = true
}

output "spaces_cors_origins" {
  description = "Origins allowed to upload from a browser — must include the site the web app is served from"
  value       = var.enable_spaces ? module.spaces[0].cors_allowed_origins : null
}

output "ssh_command" {
  value = "ssh deploy@${module.droplet.public_ip}"
}

output "deploy_notes" {
  value = <<-EOT
    1. SSH: ssh deploy@${module.droplet.public_ip}
    2. Copy app + docker-compose.prod.yml to /opt/sfa/
    3. The deploy workflow writes /opt/sfa/.env from GitHub Environment secrets on
       every run — set them there, not on the droplet, or they will be overwritten.
       Values to copy out of these outputs:
         MONGODB_URI                 terraform output -raw mongodb_uri
         STORAGE_BUCKET              terraform output -raw spaces_bucket
         STORAGE_ENDPOINT            terraform output -raw spaces_endpoint
         STORAGE_REGION              terraform output -raw spaces_region
         STORAGE_ACCESS_KEY_ID       terraform output -raw spaces_access_key_id
         STORAGE_SECRET_ACCESS_KEY   terraform output -raw spaces_secret_access_key
    4. Run: cd /opt/sfa && docker compose -f docker-compose.prod.yml up -d
    5. TLS: sudo certbot --nginx -d ${var.domain}
    6. Confirm Mongo gives us transactions — the API logs
       "MongoDB transactions available" at boot, and the lead-intake pipeline
       needs it. A "NOT a replica set" warning means degraded atomicity.
  EOT
}

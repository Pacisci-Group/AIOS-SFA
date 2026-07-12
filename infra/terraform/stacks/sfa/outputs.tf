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
  value = var.enable_spaces ? module.spaces[0].name : null
}

output "ssh_command" {
  value = "ssh deploy@${module.droplet.public_ip}"
}

output "deploy_notes" {
  value = <<-EOT
    1. SSH: ssh deploy@${module.droplet.public_ip}
    2. Copy app + docker-compose.prod.yml to /opt/sfa/
    3. Create /opt/sfa/.env with MONGODB_URI (from terraform output -raw mongodb_uri)
    4. Run: cd /opt/sfa && docker compose -f docker-compose.prod.yml up -d --build
    5. TLS: sudo certbot --nginx -d ${var.domain}
  EOT
}

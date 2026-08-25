output "fqdn" {
  description = "Fully qualified domain name"
  value       = var.subdomain == "@" ? var.domain : "${var.subdomain}.${var.domain}"
}

output "record_id" {
  description = "DNS record ID"
  value       = digitalocean_record.app.id
}

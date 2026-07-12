resource "digitalocean_domain" "this" {
  count = var.create_domain ? 1 : 0
  name  = var.domain
}

resource "digitalocean_record" "app" {
  domain = var.create_domain ? digitalocean_domain.this[0].name : var.domain
  type   = "A"
  name   = var.subdomain
  value  = var.ip_address
  ttl    = var.ttl
}

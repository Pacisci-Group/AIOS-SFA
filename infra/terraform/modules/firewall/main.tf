resource "digitalocean_firewall" "this" {
  name = var.name

  droplet_ids = var.droplet_ids

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.ssh_allowed_ips
  }

  dynamic "inbound_rule" {
    for_each = var.allow_http_https ? [1] : []
    content {
      protocol         = "tcp"
      port_range       = "80"
      source_addresses = ["0.0.0.0/0", "::/0"]
    }
  }

  dynamic "inbound_rule" {
    for_each = var.allow_http_https ? [1] : []
    content {
      protocol         = "tcp"
      port_range       = "443"
      source_addresses = ["0.0.0.0/0", "::/0"]
    }
  }

  # Droplet-to-droplet access. See `internal_rules` in variables.tf: the VPC
  # alone does not make these reachable — the firewall filters at the edge, so
  # neighbours need an explicit rule just as the public internet does.
  dynamic "inbound_rule" {
    for_each = var.internal_rules
    content {
      protocol           = "tcp"
      port_range         = inbound_rule.value.port
      source_droplet_ids = inbound_rule.value.source_droplet_ids
    }
  }

  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

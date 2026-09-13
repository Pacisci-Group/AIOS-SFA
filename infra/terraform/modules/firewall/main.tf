resource "digitalocean_firewall" "this" {
  name = var.name

  droplet_ids = var.droplet_ids

  // Attach by TAG as well as by id. An autoscale pool's droplets do not exist
  // at plan time and change as it scales, so a tag is the only way to say
  // "every member of the pool, including the ones not created yet". A droplet
  // that came up outside any firewall would be a droplet with its SSH port open
  // to the internet.
  tags = var.droplet_tags

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
      source_droplet_ids = try(inbound_rule.value.source_droplet_ids, null)
      source_tags        = try(inbound_rule.value.source_tags, null)
    }
  }

  // Traffic arriving through a load balancer. The balancer is the source, not
  // the original client, so this is what admits public traffic once droplets
  // are no longer directly addressable.
  //
  // Scoped to the balancer's own uid rather than 0.0.0.0/0: with the balancer
  // in front, nothing should reach a droplet's ports any other way, and the
  // health-check port in particular must not be answerable from the internet.
  dynamic "inbound_rule" {
    for_each = var.load_balancer_rules
    content {
      protocol                  = "tcp"
      port_range                = inbound_rule.value.port
      source_load_balancer_uids = inbound_rule.value.source_load_balancer_uids
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

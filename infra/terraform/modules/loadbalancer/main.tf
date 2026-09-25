/**
 * A DigitalOcean load balancer, in front of a tagged set of droplets.
 *
 * Targets by TAG, never by droplet id. That is the whole reason this module
 * exists in the shape it does: the droplets behind it are created and destroyed
 * by an autoscale pool, so their ids are not knowable at plan time. A tag is a
 * stable name for "whatever is currently in the pool".
 */
resource "digitalocean_loadbalancer" "this" {
  name      = var.name
  region    = var.region
  size_unit = var.size_unit

  # Placing the balancer inside the VPC is what allows an INTERNAL one to exist
  # at all, and keeps an EXTERNAL one's traffic to the droplets on private
  # addresses rather than hairpinning over the public internet.
  vpc_uuid = var.vpc_uuid

  type    = var.type
  network = var.network

  droplet_tag = var.droplet_tag

  # ⚠ Only ever true for the public balancer, and only when the backend is
  # configured to expect it.
  #
  # PROXY protocol prefixes each connection with the original client's address,
  # which is the only way to recover it when the balancer forwards TLS it cannot
  # read. Without it every caller appears to come from the balancer and the rate
  # limits that key on client IP collapse into a single bucket.
  #
  # Enabling it on one side only breaks everything: the header is read as the
  # first bytes of a TLS handshake, or the header never arrives and the backend
  # drops the connection. It is paired with EDGE_PROXY_PROTOCOL on the app.
  enable_proxy_protocol = var.enable_proxy_protocol

  dynamic "forwarding_rule" {
    for_each = var.forwarding_rules
    content {
      entry_port      = forwarding_rule.value.entry_port
      entry_protocol  = forwarding_rule.value.entry_protocol
      target_port     = forwarding_rule.value.target_port
      target_protocol = forwarding_rule.value.target_protocol

      # TLS passthrough, for the public balancer: the bytes reach the app
      # untouched and our own edge terminates them.
      #
      # Terminating here instead would mean DigitalOcean holding a certificate
      # per hostname, which for agency-owned custom domains is a manual upload
      # per domain — exactly the operator step the whole white-label design
      # exists to avoid.
      tls_passthrough = try(forwarding_rule.value.tls_passthrough, false)
    }
  }

  healthcheck {
    protocol = var.healthcheck.protocol
    port     = var.healthcheck.port
    # `path` is meaningless for a tcp check and DigitalOcean rejects it, so it
    # is only set when the check speaks HTTP.
    path                     = var.healthcheck.protocol == "http" ? var.healthcheck.path : null
    check_interval_seconds   = var.healthcheck.interval_seconds
    response_timeout_seconds = var.healthcheck.timeout_seconds
    healthy_threshold        = var.healthcheck.healthy_threshold
    unhealthy_threshold      = var.healthcheck.unhealthy_threshold
  }

  lifecycle {
    # A load balancer's address is what DNS points at and what agencies put in
    # their A records. Replacing one hands out a new address and breaks every
    # tenant domain until DNS is updated everywhere, so make a replacement
    # create the new one before destroying the old.
    create_before_destroy = true
  }
}

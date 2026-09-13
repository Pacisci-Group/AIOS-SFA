variable "environment" {
  description = "Environment name (dev, staging, production)"
  type        = string
}

variable "region" {
  description = "DigitalOcean region"
  type        = string
  default     = "nyc3"
}

variable "spaces_region" {
  description = "DigitalOcean Spaces region"
  type        = string
  default     = "nyc3"
}

variable "vpc_ip_range" {
  description = <<-EOT
    CIDR for this environment's VPC.

    ⚠ Must be unique per environment. DigitalOcean rejects a range that overlaps
    any other network **in the account** — not merely in the region — so two
    environments left on the same default collide, and the failure surfaces only
    at apply: `terraform plan` renders the range happily and the API refuses it.

    ⚠ Changing this on a live environment REPLACES the VPC, which cascades into
    the droplets and the Managed MongoDB cluster attached to it. Choose it once,
    at creation.

    Must be inside RFC1918, no larger than /16 and no smaller than /24.

    Allocated so far:
      dev         10.10.0.0/16  (the default, claimed first)
      production  10.20.0.0/16
  EOT

  type    = string
  default = "10.10.0.0/16"
}

variable "droplet_size" {
  description = "Droplet size slug"
  type        = string
}

variable "mongo_size" {
  description = "Managed MongoDB size slug"
  type        = string
}

variable "mongo_node_count" {
  description = "MongoDB node count"
  type        = number
  default     = 1
}

variable "domain_root" {
  description = "Root domain zone in DigitalOcean DNS (e.g. example.com)"
  type        = string
}

variable "dns_subdomain" {
  description = "DNS record name for this environment (e.g. dev)"
  type        = string
}

variable "domain" {
  description = "Full public hostname (e.g. dev.example.com)"
  type        = string
}

variable "enable_tls" {
  description = "Whether the site is served over HTTPS. Since the edge moved to Caddy this no longer triggers anything on the droplet — certificates are obtained on demand per hostname — but it still selects the scheme for derived values such as web_origin (Spaces CORS). Leave it true for any environment with a real domain."
  type        = bool
  default     = false
}

variable "certbot_email" {
  description = "Email for Let's Encrypt registration/expiry notices. Required — Caddy registers with it on first boot and it receives expiry warnings for every tenant certificate."
  type        = string
  default     = ""
}

variable "ssh_public_key" {
  description = "SSH public key for deploy user"
  type        = string
}

variable "ssh_allowed_ips" {
  description = "CIDR blocks allowed for SSH"
  type        = list(string)
}

variable "enable_dns" {
  description = "Create DNS A record"
  type        = bool
  default     = true
}

variable "create_domain_zone" {
  description = "Create root domain zone in DO (only if not already present)"
  type        = bool
  default     = false
}

variable "enable_reserved_ip" {
  description = "Attach reserved IP to droplet"
  type        = bool
  default     = false
}

variable "enable_spaces" {
  description = "Create Spaces bucket for this environment (required for document uploads)"
  type        = bool
  default     = false
}

variable "spaces_cors_origins" {
  description = <<-EOT
    Web origins allowed to run presigned uploads/downloads against the bucket
    (scheme + host, no trailing slash). Leave empty to derive a single origin
    from `domain` and `enable_tls`.
  EOT
  type        = list(string)
  default     = []
}

variable "create_spaces_access_key" {
  description = "Create a bucket-scoped Spaces access key for the app (STORAGE_ACCESS_KEY_ID/SECRET)"
  type        = bool
  default     = true
}

variable "enable_backups" {
  description = "Documented flag for backup policy (Mongo tier/backups)"
  type        = bool
  default     = false
}

variable "prevent_destroy" {
  description = "Prevent destroy on critical resources"
  type        = bool
  default     = false
}

variable "project_id" {
  description = "Optional DigitalOcean project ID"
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags applied to resources"
  type        = list(string)
  default     = []
}

# ─── Inngest ──────────────────────────────────────────────────────────────────

variable "enable_inngest" {
  description = <<-EOT
    Provision the Inngest droplet (self-hosted event bus, scheduler and executor
    for all asynchronous work).

    Defaults to false so environments created before async work existed continue
    to plan clean. Turning it on also opens port 4000 on the app droplet's
    firewall to the Inngest droplet, so Inngest can invoke functions.
  EOT

  type    = bool
  default = false
}

variable "inngest_droplet_size" {
  description = <<-EOT
    Size of the Inngest droplet.

    It runs a single Go binary plus SQLite, so the smallest size is genuinely
    enough at current volume. Revisit if run history grows large — the docs warn
    that large tables slow down loading and searching runs.
  EOT

  type    = string
  default = "s-1vcpu-1gb"
}

variable "mongo_allowed_ip_addresses" {
  description = <<-EOT
    Developer IPs/CIDRs allowed to reach Managed MongoDB directly.

    The app does not need an entry — it connects from the droplet. This is only
    for people running Compass, mongosh, or a migration from their machine.

    ⚠ Declare access here, never in the DigitalOcean console. The firewall
    resource owns the entire rule set, so a console-added rule is silently
    deleted by the next apply of unrelated work.
  EOT

  type    = list(string)
  default = []
}

variable "enable_node_edge" {
  description = <<-EOT
    Run the new, horizontally-scalable topology on this environment.

    Flips three things that must move together:
      * the edge: Caddy is replaced by our own Node TLS terminator, which reads
        certificates from MongoDB so every node can serve every hostname
      * the app droplet's cloud-init, which therefore no longer installs Caddy
      * the firewall rule Inngest reaches us through: port 4001 (the worker's own
        container) rather than 4000 (the API)

    ⚠ Defaults to false, which is exactly today's production behaviour, so an
    environment that does not set it plans clean and is not touched. That default
    is the whole point: this stack is shared, and without the flag a
    `terraform apply` aimed at one environment would rewrite another's edge.

    ⚠ Turning it on REPLACES the app droplet — `user_data` cannot be changed in
    place. Expect the public IP to survive (the reserved IP is re-attached) and
    everything on the box to be rebuilt. Do it on dev first.

    ⚠ It must agree with the app side, which is deployed from a git branch
    rather than from here. Terraform on 4001 with a deploy that still runs the
    worker inline on 4000 means Inngest reports healthy and syncs zero
    functions — the same failure shape `INNGEST_ENABLED`/`enable_inngest` exist
    to prevent.
  EOT
  type        = bool
  default     = false
}

variable "enable_autoscale" {
  description = <<-EOT
    Run the app tier as an autoscale pool behind a load balancer, instead of one
    directly-addressed droplet.

    ⚠ Requires `enable_node_edge`. The pool depends on every node being
    interchangeable, and that is only true once TLS certificates come from
    MongoDB rather than a node's local disk — with Caddy, each droplet would run
    its own ACME client and race the others for the same tenant hostnames.

    ⚠ Changes how deploys work. Pool members are not deployed to: they fetch
    published config from a Spaces bucket at boot and every 30s. A droplet
    created during a traffic spike has nothing to SSH to it.

    Defaults to false, which is exactly today's production shape, so an
    environment that does not set it plans clean.
  EOT
  type        = bool
  default     = false
}

variable "pool_min_instances" {
  description = "Floor for the pool. 1 keeps a single node until load justifies more; 2 is the first value that survives losing one."
  type        = number
  default     = 1
}

variable "pool_max_instances" {
  description = "Ceiling for the pool. A ceiling, not a target — it is the bound on both the blast radius of a runaway scale-up and the monthly bill."
  type        = number
  default     = 3
}

variable "pool_target_cpu" {
  description = <<-EOT
    Average CPU the pool aims to hold, 0-1.

    Not higher: this is an average across the pool, so individual droplets sit
    well above it, and scaling only begins once the average is already breached.
  EOT
  type        = number
  default     = 0.6
}

variable "pool_cooldown_minutes" {
  description = <<-EOT
    Quiet period between scaling events.

    Long enough to cover a deploy: every droplet restarts its containers then,
    which burns CPU and would otherwise read as load and trigger a scale-up
    chasing its own tail.
  EOT
  type        = number
  default     = 10
}

variable "pool_proxy_protocol" {
  description = <<-EOT
    Have the load balancer prefix each connection with the client's real address.

    ⚠ Must match EDGE_PROXY_PROTOCOL on the app. Enabling one side alone breaks
    every connection: the header is read as the first bytes of a TLS handshake,
    or it never arrives and the edge drops the connection.

    Off means every caller appears to come from the balancer, which collapses
    the public intake rate limits into a single shared bucket.
  EOT
  type        = bool
  default     = false
}

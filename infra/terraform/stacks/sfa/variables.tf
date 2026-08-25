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
  description = "Auto-run Certbot on droplet first boot to issue a Let's Encrypt cert for var.domain. Requires DNS for var.domain to already point at the droplet (best paired with a reserved IP)."
  type        = bool
  default     = false
}

variable "certbot_email" {
  description = "Email for Let's Encrypt registration/expiry notices. Required when enable_tls = true."
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

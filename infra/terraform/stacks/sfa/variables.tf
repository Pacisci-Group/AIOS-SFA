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
  description = "Create Spaces bucket for this environment"
  type        = bool
  default     = false
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

variable "name" {
  description = "MongoDB cluster name"
  type        = string
}

variable "region" {
  description = "DigitalOcean region"
  type        = string
}

variable "size" {
  description = "Database size slug"
  type        = string
}

variable "node_count" {
  description = "Number of nodes"
  type        = number
  default     = 1
}

variable "engine_version" {
  description = "MongoDB major version"
  type        = string
  default     = "7"
}

variable "database_name" {
  description = "Application database name"
  type        = string
  default     = "sfa"
}

variable "db_user_name" {
  description = "Application database user"
  type        = string
  default     = "sfa_app"
}

variable "allowed_droplet_ids" {
  description = "Droplet IDs allowed to connect"
  type        = list(string)
  default     = []
}

variable "allowed_ip_addresses" {
  description = <<-EOT
    Individual IPs or CIDRs allowed to connect, for developer machines reaching
    the cluster directly (Compass, mongosh, running a migration from a laptop).

    The application does NOT need an entry here — it connects from the droplet
    and is covered by `allowed_droplet_ids`.

    Declare access here rather than adding it in the DigitalOcean console. The
    firewall resource owns the whole rule set, so a console-added rule is deleted
    by the next apply — which is exactly what happened to two entries added on
    2026-08-12 and surfaced as unexplained drift in every plan afterwards.

    Each entry is a standing hole in the database's network perimeter, so keep
    the list short, comment who each one belongs to, and remove them when people
    leave.
  EOT

  type    = list(string)
  default = []
}

variable "enable_backups" {
  description = "Enable automated backups"
  type        = bool
  default     = false
}

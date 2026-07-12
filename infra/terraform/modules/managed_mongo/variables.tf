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

variable "enable_backups" {
  description = "Enable automated backups"
  type        = bool
  default     = false
}

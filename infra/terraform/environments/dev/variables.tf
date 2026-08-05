variable "environment" {
  type = string
}

variable "region" {
  type    = string
  default = "nyc3"
}

variable "spaces_region" {
  type    = string
  default = "nyc3"
}

variable "droplet_size" {
  type = string
}

variable "mongo_size" {
  type = string
}

variable "mongo_node_count" {
  type    = number
  default = 1
}

variable "domain_root" {
  type = string
}

variable "dns_subdomain" {
  type = string
}

variable "domain" {
  type = string
}

variable "enable_tls" {
  type    = bool
  default = false
}

variable "certbot_email" {
  type    = string
  default = ""
}

variable "ssh_public_key" {
  type      = string
  sensitive = true
}

variable "ssh_allowed_ips" {
  type = list(string)
}

variable "enable_dns" {
  type    = bool
  default = true
}

variable "create_domain_zone" {
  type    = bool
  default = false
}

variable "enable_reserved_ip" {
  type    = bool
  default = false
}

variable "enable_spaces" {
  type    = bool
  default = false
}

variable "spaces_cors_origins" {
  type    = list(string)
  default = []
}

variable "create_spaces_access_key" {
  type    = bool
  default = true
}

variable "enable_backups" {
  type    = bool
  default = false
}

variable "prevent_destroy" {
  type    = bool
  default = false
}

variable "project_id" {
  type    = string
  default = ""
}

variable "tags" {
  type    = list(string)
  default = []
}

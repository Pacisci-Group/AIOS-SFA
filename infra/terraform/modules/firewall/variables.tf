variable "name" {
  description = "Firewall name"
  type        = string
}

variable "droplet_ids" {
  description = "Droplet IDs to attach"
  type        = list(string)
}

variable "ssh_allowed_ips" {
  description = "CIDR blocks allowed for SSH"
  type        = list(string)
}

variable "allow_http_https" {
  description = "Allow inbound HTTP/HTTPS from anywhere"
  type        = bool
  default     = true
}

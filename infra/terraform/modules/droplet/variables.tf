variable "name" {
  description = "Droplet name"
  type        = string
}

variable "region" {
  description = "DigitalOcean region"
  type        = string
}

variable "size" {
  description = "Droplet size slug"
  type        = string
}

variable "vpc_uuid" {
  description = "VPC UUID"
  type        = string
}

variable "ssh_key_fingerprints" {
  description = "SSH key fingerprints to install on the Droplet"
  type        = list(string)
}

variable "user_data" {
  description = "Cloud-init user data"
  type        = string
  default     = ""
}

variable "enable_monitoring" {
  description = "Enable DO monitoring agent"
  type        = bool
  default     = true
}

variable "enable_reserved_ip" {
  description = "Attach a reserved IP"
  type        = bool
  default     = false
}

variable "tags" {
  description = "Droplet tags"
  type        = list(string)
  default     = []
}

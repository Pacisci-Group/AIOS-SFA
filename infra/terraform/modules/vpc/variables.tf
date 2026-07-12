variable "name" {
  description = "VPC name"
  type        = string
}

variable "region" {
  description = "DigitalOcean region slug"
  type        = string
}

variable "ip_range" {
  description = "VPC IP range CIDR"
  type        = string
  default     = "10.10.0.0/16"
}

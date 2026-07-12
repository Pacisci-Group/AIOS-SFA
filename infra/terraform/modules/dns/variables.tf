variable "domain" {
  description = "Root domain managed in DigitalOcean DNS (e.g. example.com)"
  type        = string
}

variable "subdomain" {
  description = "Record name (e.g. dev for dev.example.com). Use @ for apex."
  type        = string
}

variable "ip_address" {
  description = "IPv4 address for the A record"
  type        = string
}

variable "create_domain" {
  description = "Create the root domain in DO DNS if it does not exist"
  type        = bool
  default     = false
}

variable "ttl" {
  description = "DNS TTL in seconds"
  type        = number
  default     = 300
}

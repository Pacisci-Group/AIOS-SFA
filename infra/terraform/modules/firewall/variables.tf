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

variable "internal_rules" {
  description = <<-EOT
    Droplet-to-droplet inbound rules, e.g. the app droplet reaching Inngest on
    8288 and Inngest invoking functions on 4000.

    These are REQUIRED for traffic between droplets even when both sit in the
    same VPC: a DigitalOcean firewall filters at the network edge, so a droplet
    with no matching inbound rule is unreachable from its VPC neighbours too.

    `source_droplet_ids` rather than CIDRs on purpose — it survives a droplet
    being replaced and its private IP changing.

    Defaults to none, so existing callers are unaffected.
  EOT

  type = list(object({
    port               = string
    source_droplet_ids = list(string)
  }))
  default = []
}

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

    `source_tags` is the autoscale equivalent: pool members do not exist at plan
    time, so an id-based rule would admit only the droplets that happened to
    exist at the last apply and silently refuse every one created since.

    Defaults to none, so existing callers are unaffected.
  EOT

  type = list(object({
    port               = string
    source_droplet_ids = optional(list(string))
    source_tags        = optional(list(string))
  }))
  default = []
}

variable "droplet_tags" {
  description = <<-EOT
    Tags naming droplets this firewall applies to, alongside `droplet_ids`.

    Required for an autoscale pool: its members are created after the apply, so
    only a tag can cover them. Without it a scaled-up droplet would come up with
    no firewall at all.
  EOT
  type        = list(string)
  default     = []
}

variable "load_balancer_rules" {
  description = <<-EOT
    Ports admitted from a load balancer, by the balancer's uid.

    Narrower than opening the port to the internet, which matters most for the
    health-check port: it exists for the balancer and should be answerable by
    nothing else.
  EOT
  type = list(object({
    port                      = string
    source_load_balancer_uids = list(string)
  }))
  default = []
}

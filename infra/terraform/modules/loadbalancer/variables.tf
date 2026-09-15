variable "name" {
  description = "Load balancer name"
  type        = string
}

variable "region" {
  type = string
}

variable "vpc_uuid" {
  description = "VPC to place the balancer in. Required for an INTERNAL one."
  type        = string
}

variable "droplet_tag" {
  description = <<-EOT
    Tag naming the droplets to balance across.

    A tag rather than explicit ids because the backends are an autoscale pool:
    which droplets exist is not knowable at plan time, and membership changes
    without terraform running.
  EOT
  type        = string
}

variable "type" {
  description = "REGIONAL (application) or REGIONAL_NETWORK (layer 4, required for INTERNAL)."
  type        = string
  default     = "REGIONAL"
}

variable "network" {
  description = "EXTERNAL for the public balancer, INTERNAL for one reachable only inside the VPC."
  type        = string
  default     = "EXTERNAL"
}

variable "size_unit" {
  description = "Balancer capacity, 1-200. One unit is ample at current volume."
  type        = number
  default     = 1
}

variable "enable_proxy_protocol" {
  description = <<-EOT
    Prefix each connection with the client's real address.

    ⚠ Must match the backend. The app reads it only when EDGE_PROXY_PROTOCOL is
    true; enabling one side alone breaks every connection through this balancer.
  EOT
  type        = bool
  default     = false
}

variable "forwarding_rules" {
  description = "Ports to forward. `tls_passthrough` is optional per rule."
  type = list(object({
    entry_port      = number
    entry_protocol  = string
    target_port     = number
    target_protocol = string
    tls_passthrough = optional(bool, false)
  }))
}

variable "healthcheck" {
  description = <<-EOT
    How the balancer decides a droplet may receive traffic.

    ⚠ With `enable_proxy_protocol`, this must NOT point at a port that expects a
    PROXY header — the balancer's own check does not send one, so the backend
    would drop it and every droplet would be marked unhealthy while serving
    perfectly. The app exposes a separate health port for exactly this.
  EOT
  type = object({
    protocol            = string
    port                = number
    path                = optional(string, "/")
    interval_seconds    = optional(number, 10)
    timeout_seconds     = optional(number, 5)
    healthy_threshold   = optional(number, 3)
    unhealthy_threshold = optional(number, 3)
  })
}

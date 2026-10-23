variable "name" {
  description = "Bucket name. Must be globally unique across DigitalOcean Spaces."
  type        = string
}

variable "region" {
  description = "Spaces region slug."
  type        = string
}

variable "adhoc_retention_days" {
  description = <<-EOT
    How long manual and pre-deploy snapshots are kept before the bucket deletes
    them. Scheduled (weekly/) archives are not affected: the worker keeps one
    per schedule week for the newest DB_BACKUP_KEEP weeks and deletes the rest
    itself.
  EOT
  type        = number
  default     = 90
}

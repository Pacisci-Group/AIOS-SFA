variable "name" {
  description = "Spaces bucket name (globally unique)"
  type        = string
}

variable "region" {
  description = "Spaces region slug"
  type        = string
}

variable "acl" {
  description = "Bucket ACL"
  type        = string
  default     = "private"
}

variable "versioning_enabled" {
  description = "Enable object versioning"
  type        = bool
  default     = true
}

variable "cors_allowed_origins" {
  description = <<-EOT
    Web origins allowed to run presigned uploads/downloads against this bucket
    (scheme + host, no trailing slash). Empty disables the CORS rule entirely,
    which breaks browser uploads — only leave it empty for a bucket that nothing
    uploads to from a browser.
  EOT
  type        = list(string)
  default     = []
}

variable "cors_max_age_seconds" {
  description = "How long the browser may cache the CORS preflight response"
  type        = number
  default     = 3600
}

variable "create_access_key" {
  description = "Create a bucket-scoped Spaces access key for the application"
  type        = bool
  default     = true
}

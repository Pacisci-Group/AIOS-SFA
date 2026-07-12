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

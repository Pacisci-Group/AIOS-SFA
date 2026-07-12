variable "region" {
  description = "Spaces region for the state bucket"
  type        = string
  default     = "nyc3"
}

variable "state_bucket_name" {
  description = "Globally unique name for the Terraform state bucket"
  type        = string
}

variable "spaces_access_id" {
  description = "Spaces access key ID (or set SPACES_ACCESS_KEY_ID env var)"
  type        = string
  default     = null
  sensitive   = true
}

variable "spaces_secret_key" {
  description = "Spaces secret key (or set SPACES_SECRET_ACCESS_KEY env var)"
  type        = string
  default     = null
  sensitive   = true
}

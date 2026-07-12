SHELL := /bin/bash

# Usage:
#   make bootstrap                 # create remote state bucket (once)
#   make init ENV=dev              # terraform init for an env
#   make plan ENV=dev              # terraform plan
#   make apply ENV=dev             # terraform apply
#   make output ENV=dev            # show outputs
#   make create ENV=staging        # spin up a NEW env (staging/production)
#   make destroy ENV=staging       # tear down a non-prod env
#   make fmt                       # terraform fmt -recursive

TF_ROOT := $(CURDIR)
ENV ?=
ENV_DIR := $(TF_ROOT)/environments/$(ENV)

.PHONY: help bootstrap init plan apply output create destroy fmt validate _require_env

help:
	@echo "SFA Terraform — targets:"
	@echo "  make bootstrap              Create remote state bucket (run once)"
	@echo "  make init ENV=dev           terraform init"
	@echo "  make plan ENV=dev           terraform plan"
	@echo "  make apply ENV=dev          terraform apply"
	@echo "  make output ENV=dev         Show outputs"
	@echo "  make create ENV=staging     Create a new environment (one command)"
	@echo "  make destroy ENV=staging    Destroy a non-prod environment"
	@echo "  make fmt                    Format all terraform files"

_require_env:
	@if [ -z "$(ENV)" ]; then echo "ERROR: set ENV, e.g. make apply ENV=dev"; exit 1; fi
	@if [ ! -d "$(ENV_DIR)" ]; then echo "ERROR: environment '$(ENV)' not found. Use 'make create ENV=$(ENV)'."; exit 1; fi

bootstrap:
	terraform -chdir=bootstrap init -input=false
	terraform -chdir=bootstrap apply -input=false

init: _require_env
	terraform -chdir=$(ENV_DIR) init -input=false

plan: _require_env
	terraform -chdir=$(ENV_DIR) plan -input=false -var-file=terraform.tfvars

apply: _require_env
	terraform -chdir=$(ENV_DIR) apply -input=false -var-file=terraform.tfvars

output: _require_env
	terraform -chdir=$(ENV_DIR) output

create:
	@if [ -z "$(ENV)" ]; then echo "ERROR: set ENV, e.g. make create ENV=staging"; exit 1; fi
	./scripts/create-env.sh $(ENV)

destroy:
	@if [ -z "$(ENV)" ]; then echo "ERROR: set ENV, e.g. make destroy ENV=staging"; exit 1; fi
	./scripts/destroy-env.sh $(ENV)

fmt:
	terraform fmt -recursive

validate: _require_env
	terraform -chdir=$(ENV_DIR) validate

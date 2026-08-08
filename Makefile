# SFA local development — two ways to run the stack.
#
#   make dev   backing services in Docker, app on the host   <- default dev loop
#   make up    everything in Docker (build + run)
#
# Docker-side services split by compose profile (see docker-compose.yml): mongo,
# minio and redis have no profile so they start in both modes; api and web sit
# behind `--profile app`.
.PHONY: help dev infra up start down stop build logs logs-infra restart ps seed seed-demo

COMPOSE := docker compose
APP     := $(COMPOSE) --profile app

help:
	@echo "SFA Platform — local stack"
	@echo ""
	@echo "  Backing services in Docker, app on the host (default dev loop):"
	@echo "    make dev        Start Mongo + MinIO + Redis only"
	@echo "    make seed       Seed the core super admin + tenant scaffold"
	@echo "    make seed-demo  Seed the full synthetic demo agency"
	@echo ""
	@echo "  Everything in Docker:"
	@echo "    make up         Build and start Mongo, MinIO, Redis, API and web"
	@echo ""
	@echo "  Both:"
	@echo "    make down       Stop and remove all containers"
	@echo "    make logs       Follow logs (all services)"
	@echo "    make logs-infra Follow logs (backing services only)"
	@echo "    make restart    down, then up"
	@echo "    make ps         Show running services"
	@echo ""
	@echo "  (make infra is an alias for make dev)"

# Backing services only. Stops the app containers first — a leftover sfa-api
# from `make up` holds port 4000 and the host `npm run api:dev` would fail to
# bind. `--remove-orphans` is not enough: profiled services are not orphans.
#
# `infra` is kept as an alias only because it is easy to reach for; the two do
# exactly the same thing.
dev infra:
	-$(APP) stop api web 2>/dev/null
	$(COMPOSE) up -d
	@echo ""
	@echo "Backing services are running:"
	@echo "  Mongo: mongodb://localhost:27017/sfa"
	@echo "  MinIO: http://localhost:9000  (console http://localhost:9001)"
	@echo "  Redis: redis://localhost:6379  (used only if REDIS_URL is set in .env)"
	@echo ""
	@echo "Now run the app on the host, in two terminals:"
	@echo "  npm run api:dev   -> http://localhost:4000/api/v1"
	@echo "  npm run web:dev   -> http://localhost:5173"
	@echo ""
	@echo "First run against an empty database also needs a seed:"
	@echo "  make seed         (super admin only)  or  make seed-demo  (full demo agency)"

# Nothing seeds Mongo in this mode — the auto-seed lives in the containerized
# API's start command, which is not running here.
seed:
	npm run api:seed:dev

seed-demo:
	npm run api:seed:demo:dev

up start: build
	$(APP) up -d
	@echo ""
	@echo "SFA is running:"
	@echo "  Web:   http://localhost:5173"
	@echo "  API:   http://localhost:4000/api/v1"
	@echo "  Mongo: mongodb://localhost:27017/sfa"

# `--profile app` on down too: without it the app containers are out of scope
# and survive the teardown.
down stop:
	$(APP) down

build:
	$(APP) build

logs:
	$(APP) logs -f

logs-infra:
	$(COMPOSE) logs -f

restart: down up

ps:
	$(APP) ps

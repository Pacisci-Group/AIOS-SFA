.PHONY: help up down start stop build logs restart ps

COMPOSE := docker compose

help:
	@echo "SFA Platform — Docker commands"
	@echo ""
	@echo "  make up       Build and start API + web (detached)"
	@echo "  make down     Stop and remove containers"
	@echo "  make logs     Follow container logs"
	@echo "  make build    Build images without starting"
	@echo "  make restart  Stop then start"
	@echo "  make ps       Show running services"

up start: build
	$(COMPOSE) up -d
	@echo ""
	@echo "SFA is running:"
	@echo "  Web: http://localhost:5173"
	@echo "  API: http://localhost:4000/api/v1"

down stop:
	$(COMPOSE) down

build:
	$(COMPOSE) build

logs:
	$(COMPOSE) logs -f

restart: down up

ps:
	$(COMPOSE) ps

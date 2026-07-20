# contrib-dashboard — dev environment targets.
#
# `make tilt-up` creates a local kind cluster (if missing) and runs the
# standalone Tiltfile, which stands up a static kcp + the dashboard on top.
#
# Requires a local kcp checkout for the tilt library/infra manifests. Point
# KCP_DIR at it (default: ../kcp).

CLUSTER_NAME ?= kcp-tilt
KCP_DIR      ?= ../kcp
KCP_HOSTS    := kcp.localhost root.kcp.localhost theseus.kcp.localhost dex.kcp.localhost

export KCP_DIR

.PHONY: tilt-up
tilt-up: kind-up ## Create the kind cluster (if needed) and run tilt up (no-oidc).
	tilt up

.PHONY: tilt-up-oidc
tilt-up-oidc: export KCP_OIDC_ENABLED = true
tilt-up-oidc: kind-up ## Create the kind cluster (if needed) and run tilt up with in-cluster Dex OIDC.
	tilt up

.PHONY: kind-up
kind-up: check-tools check-hosts ## Create the kind cluster if it does not exist.
	@if ! kind get clusters | grep -w -q "$(CLUSTER_NAME)"; then \
		echo "Creating kind cluster '$(CLUSTER_NAME)'..."; \
		kind create cluster --name "$(CLUSTER_NAME)"; \
	else \
		echo "kind cluster '$(CLUSTER_NAME)' already exists."; \
	fi
	kind export kubeconfig --name "$(CLUSTER_NAME)"

.PHONY: kind-down
kind-down: ## Delete the kind cluster.
	kind delete cluster --name "$(CLUSTER_NAME)"

.PHONY: tilt-down
tilt-down: ## Stop tilt and tear down its resources.
	tilt down

.PHONY: check-tools
check-tools:
	@command -v kind >/dev/null 2>&1 || { echo "kind not found — see https://kind.sigs.k8s.io/docs/user/quick-start/#installation"; exit 1; }
	@command -v helm >/dev/null 2>&1 || { echo "helm not found — see https://helm.sh/docs/intro/install/"; exit 1; }
	@command -v tilt >/dev/null 2>&1 || { echo "tilt not found — see https://github.com/tilt-dev/tilt#install-tilt"; exit 1; }
	@test -f "$(KCP_DIR)/contrib/tilt/kcp_static.Tiltfile" || { echo "kcp tilt library not found at $(KCP_DIR)/contrib/tilt — set KCP_DIR to your kcp checkout"; exit 1; }

.PHONY: check-hosts
check-hosts:
	@missing=""; \
	for h in $(KCP_HOSTS); do \
		grep -Eq "(^|[[:space:]])$${h//./\\.}([[:space:]]|\$$)" /etc/hosts 2>/dev/null || missing="$$missing $$h"; \
	done; \
	if [ -n "$$missing" ]; then \
		echo "WARNING: the following kcp hostnames do not resolve via /etc/hosts:$$missing"; \
		echo "Add this line to /etc/hosts (e.g. 'sudo vi /etc/hosts'), otherwise kubectl will fail with 'no such host':"; \
		echo; \
		echo "  127.0.0.1 $(KCP_HOSTS)"; \
		echo; \
	else \
		echo "/etc/hosts entries for kcp hostnames: OK"; \
	fi

.PHONY: help
help: ## Show this help.
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

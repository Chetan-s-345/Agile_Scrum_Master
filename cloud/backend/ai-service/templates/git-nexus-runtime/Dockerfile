# E2B GitNexus Runtime Template Dockerfile
# Repository analysis engine using GitNexus CLI
# Source: https://github.com/abhigyanpatwari/GitNexus.git

FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Install system utilities needed for repo analysis and sandbox work.
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    ca-certificates \
    procps \
    jq \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install GitNexus globally so the CLI is always available in the sandbox.
RUN npm install -g gitnexus@1.6.3

# Create working directories used by the analyzer.
RUN mkdir -p /home/user/repo /home/user/analysis

# Set working directory.
WORKDIR /home/user

# Keep the image honest: fail fast if Node, npm, or GitNexus disappear.
RUN node --version && npm --version && gitnexus --help >/dev/null

# Health check verifies the CLI is present and runnable.
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
    CMD node --version >/dev/null && npm --version >/dev/null && gitnexus --help >/dev/null || exit 1

# Default entry point (can be overridden)
CMD ["/bin/bash"]

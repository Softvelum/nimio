#!/usr/bin/env bash
set -e

mkdir -p ssl

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout ssl/dev.key \
  -out ssl/dev.crt \
  -days 3650 \
  -subj "/CN=localhost"

#!/usr/bin/env bash
set -e

mkdir -p ssl

# Collect local IPv4 addresses and include them in SAN.
san_list="DNS:localhost,IP:127.0.0.1,IP:::1"
for ip in $(ifconfig -a | awk '/inet /{print $2}' | grep -v '^127\.'); do
  san_list="${san_list},IP:${ip}"
done

# Allow passing extra SAN entries as args (IPs or DNS names).
for entry in "$@"; do
  if [[ "$entry" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ || "$entry" == *":"* ]]; then
    san_list="${san_list},IP:${entry}"
  else
    san_list="${san_list},DNS:${entry}"
  fi
done

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout ssl/dev.key \
  -out ssl/dev.crt \
  -days 3650 \
  -subj "/CN=Nimio dev crt" \
  -addext "subjectAltName=${san_list}"

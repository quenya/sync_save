#!/usr/bin/env bash
set -euo pipefail

echo "This repo uses Cloudflare Tunnel, so DNS/domain updates are managed in Cloudflare."
echo "Use this file as an execution checklist, not as a DNS API client."
echo
echo "1) Confirm hostnames in Tunnel config: api.example.com -> http://api:3000"
echo "2) Confirm hostnames in Tunnel config: app.example.com -> http://web:3001"
echo "3) Restart tunnel after Tunnel token rotate:"
echo "   docker compose -f /opt/sync_save/docker-compose.prod.yml restart cloudflared"
echo "4) Verify from remote:"
echo "   curl -I https://app.example.com"
echo "   curl -I https://api.example.com/health"

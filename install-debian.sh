#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Spusťte skript jako root: sudo bash ./install-debian.sh" >&2
  exit 1
fi
if [[ -d /var/lib/3cxpbx && "${THREEX_HOST_MODE:-false}" != "true" ]]; then
  echo "Byl rozpoznán hostitel 3CX. Použijte ./install-3cx-host.sh; tento obecný instalátor by mohl měnit systémové balíčky a veřejné služby." >&2
  exit 1
fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
if [[ ! -f compose.yaml || ! -f .env.example || ! -d migrations ]]; then
  echo "Skript musí být spuštěn z kořene projektu 3CX Service Intake." >&2
  exit 1
fi

[[ -r /etc/os-release ]] || { echo "Nelze ověřit distribuci Linuxu." >&2; exit 1; }
# shellcheck disable=SC1091
. /etc/os-release
if [[ "${ID:-}" != debian || ( "${VERSION_CODENAME:-}" != bookworm && "${VERSION_CODENAME:-}" != trixie ) ]]; then
  echo "Podporován je Debian 12 (Bookworm) nebo Debian 13 (Trixie)." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  if [[ "${THREEX_HOST_MODE:-false}" == "true" ]]; then
    echo "Na hostiteli 3CX Docker automaticky neinstaluji. Nainstalujte jej samostatně pouze po přijetí dopadu na podporu 3CX, nebo spusťte instalaci na externím hostiteli." >&2
    exit 1
  fi
  for package in docker.io docker-compose docker-compose-v2 podman-docker containerd runc; do
    if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
      echo "Nalezen konfliktní balíček $package. Odeberte jej podle dokumentace Dockeru a spusťte instalaci znovu." >&2
      exit 1
    fi
  done
  apt-get update
  apt-get install -y ca-certificates curl git openssl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi
for tool in curl openssl python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    if [[ "${THREEX_HOST_MODE:-false}" == "true" ]]; then
      echo "Na hostiteli 3CX chybí příkaz $tool. Instalační skript nebude měnit systémové balíčky; doplňte jej samostatně nebo použijte přenos archivu projektu." >&2
      exit 1
    fi
    apt-get update
    apt-get install -y "$tool"
  fi
done

if [[ ! -f .env ]]; then

  prompt_value() {
    local label="$1" variable="$2" default="${3-}" value
    if [[ -n "$default" ]]; then
      read -r -p "$label [$default]: " value
      value="${value:-$default}"
    else
      while :; do
        read -r -p "$label: " value
        [[ -n "$value" ]] && break
        echo "Hodnota nesmí být prázdná."
      done
    fi
    [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || { echo "Hodnota nesmí obsahovat nový řádek." >&2; exit 1; }
    printf -v "$variable" '%s' "$value"
  }
  prompt_secret() {
    local label="$1" variable="$2" minimum="$3" value confirm
    while :; do
      read -r -s -p "$label: " value; echo
      if (( ${#value} < minimum )); then echo "Heslo musí mít alespoň $minimum znaků."; continue; fi
      read -r -s -p "Zopakujte $label: " confirm; echo
      if [[ "$value" != "$confirm" ]]; then echo "Zadané hodnoty se neshodují."; continue; fi
      [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || { echo "Hodnota nesmí obsahovat nový řádek." >&2; exit 1; }
      printf -v "$variable" '%s' "$value"
      return
    done
  }

  echo "Nastavení 3CX a OpenAI. Tajné údaje se při zadávání nezobrazují."
  prompt_value "HTTPS adresa 3CX PBX" PBX_BASE
  [[ "$PBX_BASE" == https://* ]] || { echo "PBX_BASE musí začínat https://" >&2; exit 1; }
  prompt_value "Client ID Service Principal / programovatelné klapky" PBX_APP_ID
  prompt_secret "API klíč Service Principal" PBX_APP_SECRET 1
  prompt_secret "OpenAI API klíč" OPENAI_API_KEY 1
  prompt_value "OpenAI Realtime model" OPENAI_MODEL "gpt-realtime-2"
  BASE_PATH_DEFAULT="${APP_BASE_PATH_DEFAULT:-}"
  read -r -p "URL prefix dashboardu (prázdné = kořen; pro 3CX například /servis) [$BASE_PATH_DEFAULT]: " APP_BASE_PATH
  APP_BASE_PATH="${APP_BASE_PATH:-$BASE_PATH_DEFAULT}"
  [[ "$APP_BASE_PATH" =~ ^(/[a-z0-9]([a-z0-9/-]*[a-z0-9])?)?$ ]] || { echo "Neplatný URL prefix." >&2; exit 1; }
  prompt_value "Název společnosti v pozdravu" COMPANY_NAME "Agropartner"
  prompt_value "Jméno hlasového asistenta" AGENT_NAME "Asistentka"
  read -r -p "Interní číslo testovací fronty (nechte prázdné, pokud zatím není nastavena): " SERVICE_QUEUE_EXTENSION
  prompt_value "Uživatelské jméno účtu pouze pro čtení" DASHBOARD_USERNAME "client"
  prompt_secret "Heslo účtu pouze pro čtení" DASHBOARD_PASSWORD 24
  prompt_value "Uživatelské jméno správce" ADMIN_USERNAME "admin"
  [[ "${ADMIN_USERNAME,,}" != "${DASHBOARD_USERNAME,,}" ]] || { echo "Uživatelská jména správce a čtenáře musí být různá." >&2; exit 1; }
  prompt_secret "Heslo správce" ADMIN_PASSWORD 24

  POSTGRES_PASSWORD="$(openssl rand -hex 32)"
  THREEX_REPORT_CALL_TOKEN="$(openssl rand -hex 32)"
  DATABASE_URL="postgres://intake:${POSTGRES_PASSWORD}@db:5432/intake"
  export PBX_BASE PBX_APP_ID PBX_APP_SECRET OPENAI_API_KEY OPENAI_MODEL APP_BASE_PATH COMPANY_NAME AGENT_NAME SERVICE_QUEUE_EXTENSION
  export DASHBOARD_USERNAME DASHBOARD_PASSWORD ADMIN_USERNAME ADMIN_PASSWORD POSTGRES_PASSWORD DATABASE_URL THREEX_REPORT_CALL_TOKEN
  umask 077
  python3 - <<'PY'
import os
from pathlib import Path
keys = [
    'NODE_ENV', 'HOST', 'PORT', 'APP_BASE_PATH', 'DATABASE_URL', 'POSTGRES_PASSWORD',
    'PBX_BASE', 'PBX_APP_ID', 'PBX_APP_SECRET', 'SERVICE_QUEUE_EXTENSION',
    'SERVICE_DISPATCH_ENABLED', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_VOICE',
    'COMPANY_NAME', 'AGENT_PROFILE', 'AGENT_NAME', 'TEST_OUTBOUND_ENABLED',
    'TEST_AUDIO_TONE_HZ', 'TEST_AUDIO_TONE_MS', 'DASHBOARD_USERNAME',
    'DASHBOARD_PASSWORD', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'PUBLIC_DOMAIN',
    'THREEX_REPORT_CALL_TOKEN', 'LOG_LEVEL'
]
defaults = {
    'NODE_ENV': 'production', 'HOST': '0.0.0.0', 'PORT': '3000',
    'SERVICE_DISPATCH_ENABLED': 'false', 'OPENAI_VOICE': 'alloy',
    'AGENT_PROFILE': 'service-intake', 'TEST_OUTBOUND_ENABLED': 'false',
    'TEST_AUDIO_TONE_HZ': '700', 'TEST_AUDIO_TONE_MS': '500',
    'PUBLIC_DOMAIN': '', 'LOG_LEVEL': 'info'
}
def quote(value):
    if '\n' in value or '\r' in value:
        raise SystemExit('Environment values cannot contain newlines.')
    if all(c.isalnum() or c in '._:/@+-' for c in value):
        return value
    return "'" + value.replace('\\', '\\\\').replace("'", "\\'") + "'"
content = '\n'.join(f'{key}={quote(os.environ.get(key, defaults.get(key, "")))}' for key in keys) + '\n'
Path('.env').write_text(content, encoding='utf-8')
Path('.env').chmod(0o600)
PY
else
  echo "Soubor .env už existuje; jeho hodnoty nepřepisuji."
fi

docker compose config -q
docker compose up --build -d
healthy=0
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/health; then healthy=1; echo; break; fi
  sleep 2
done
if [[ "$healthy" -ne 1 ]]; then
  echo "Aplikace se nespustila. Poslední logy:" >&2
  docker compose logs --tail=100 app >&2
  exit 1
fi

docker compose ps
echo
echo "Instalace dokončena. Dashboard je lokálně na http://127.0.0.1:3000/."
echo "Předání technikovi zůstává vypnuté (SERVICE_DISPATCH_ENABLED=false)."
echo "ReportCall token pro CRM šablonu 3CX je v .env: grep '^THREEX_REPORT_CALL_TOKEN=' .env"
echo "Caddy ani veřejné porty se tímto skriptem nezapínají. Pro veřejný přístup nastavte DNS, HTTPS a firewall/router."

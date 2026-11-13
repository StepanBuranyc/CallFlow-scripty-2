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

validate_pbx_base() {
  python3 -c '
import ipaddress, sys
from urllib.parse import urlsplit

try:
    url = urlsplit(sys.stdin.read().strip())
    host = url.hostname
    port = url.port
    if (url.scheme != "https" or not host or url.username is not None
            or url.path not in ("", "/") or url.query or url.fragment
            or any(c.isspace() for c in host)):
        raise ValueError
    try:
        ipaddress.ip_address(host)
    except ValueError:
        if "." in host and not host.replace(".", "").isdigit():
            sys.exit(0)
except ValueError:
    pass
sys.exit("PBX_BASE musí být HTTPS adresa s DNS názvem z certifikátu 3CX, např. https://pbx.firma.cz.")
' <<< "$1"
}

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

  cat <<'EOF'

PŘIPRAVTE SI PŘÍSTUPOVÉ ÚDAJE

3CX Service Principal:
  1. V administraci 3CX otevřete Admin > Integrations > API > Add a Service Principal.
  2. Zadejte Client ID (např. service-intake) a povolte přístup k 3CX Call Control API.
     Přístup k Configuration API/XAPI tato aplikace nepotřebuje.
  3. Uložte Service Principal a zkopírujte jeho Client ID a vygenerovaný API klíč.
     Klíč si bezpečně uschovejte; nemusí být možné jej znovu zobrazit.
  4. Připravte HTTPS adresu PBX s názvem z jejího TLS certifikátu, například https://pbx.firma.cz.

OpenAI API:
  1. Na https://platform.openai.com/api-keys vyberte projekt a vytvořte tajný API klíč.
  2. Projekt musí mít povolený zvolený Realtime model a dostupný API rozpočet/kvótu.
     API spotřeba se účtuje odděleně od předplatného ChatGPT.
  3. Klíč se zobrazí jen při vytvoření. Uschovejte jej a nevkládejte do GitHubu.

Následující dialog se zeptá na PBX URL, Client ID, 3CX API klíč a OpenAI API klíč.
Tajné klíče se při psaní nezobrazují. Uloží se pouze do lokálního souboru .env.

EOF
  read -r -p "Až máte údaje připravené, stiskněte Enter..." _
  prompt_value "HTTPS základní adresa 3CX PBX (např. https://pbx.firma.cz)" PBX_BASE
  validate_pbx_base "$PBX_BASE" || exit 1
  prompt_value "3CX Service Principal Client ID (programovatelná klapka)" PBX_APP_ID
  prompt_secret "3CX Service Principal API klíč" PBX_APP_SECRET 1
  prompt_secret "OpenAI API tajný klíč projektu" OPENAI_API_KEY 1
  prompt_value "OpenAI Realtime model dostupný v projektu" OPENAI_MODEL "gpt-realtime-2.1"
  BASE_PATH_DEFAULT="${APP_BASE_PATH_DEFAULT:-}"
  read -r -p "URL prefix dashboardu (prázdné = kořen; pro 3CX například /servis) [$BASE_PATH_DEFAULT]: " APP_BASE_PATH
  APP_BASE_PATH="${APP_BASE_PATH:-$BASE_PATH_DEFAULT}"
  [[ "$APP_BASE_PATH" =~ ^(/[a-z0-9]([a-z0-9/-]*[a-z0-9])?)?$ ]] || { echo "Neplatný URL prefix." >&2; exit 1; }
  if [[ "${THREEX_HOST_MODE:-false}" != true ]]; then
    read -r -p "HTTPS adresa dashboardu pro CRM (např. https://servis.firma.cz, prázdné = nastavíte později): " CRM_PUBLIC_ORIGIN
  fi
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
  export CRM_PUBLIC_ORIGIN
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
    'DASHBOARD_PASSWORD', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'PUBLIC_DOMAIN', 'CRM_PUBLIC_ORIGIN',
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

readarray -t crm_config < <(docker compose config --format json | python3 -c '
import json, sys
env = json.load(sys.stdin)["services"]["app"]["environment"]
for key in ("PBX_BASE", "APP_BASE_PATH", "CRM_PUBLIC_ORIGIN"):
    print(env.get(key) or "")
')
pbx_base="${crm_config[0]:-}"
validate_pbx_base "$pbx_base" || exit 1
crm_origin="${crm_config[2]:-}"
if [[ "${THREEX_HOST_MODE:-false}" == true ]]; then
  crm_origin="$pbx_base"
fi
crm_webhook_url=""
if [[ -n "$crm_origin" ]]; then
  validate_pbx_base "$crm_origin" || exit 1
  crm_webhook_url="${crm_origin%/}${crm_config[1]:-}/integrations/3cx/report-call"
fi
build_compose=(docker compose)
case "${BUILD_NETWORK:-default}" in
  default) ;;
  host) build_compose+=(-f compose.yaml -f compose.build-host.yaml) ;;
  *) echo "BUILD_NETWORK musí být default nebo host." >&2; exit 1 ;;
esac
if ! "${build_compose[@]}" build app; then
  echo "Sestavení aplikace selhalo. Při chybě DNS nebo připojení k npm ověřte na Debianu:" >&2
  echo "  curl -fsS --max-time 10 https://registry.npmjs.org/-/ping" >&2
  echo "Pokud test na Debianu projde, zkuste stejný instalátor s BUILD_NETWORK=host." >&2
  exit 1
fi
if ! docker compose run --rm --no-deps app node --input-type=module -e '
  try {
    const response = await fetch(new URL("/connect/token", process.env.PBX_BASE), {
      redirect: "manual", signal: AbortSignal.timeout(8000)
    });
    console.log(`3CX HTTPS je dostupné z kontejneru (HTTP ${response.status}).`);
  } catch (error) {
    console.error(`HTTPS spojení s 3CX selhalo: ${error.cause?.code ?? error.name}`);
    process.exitCode = 1;
  }
'; then
  echo "Ověřte DNS, dostupnost HTTPS a certifikát 3CX z kontejneru." >&2
  echo "Pokud se doména překládá na nedostupnou veřejnou IP, použijte interní DNS nebo extra_hosts v compose.override.yaml podle README." >&2
  exit 1
fi
docker compose up --no-build -d
healthy=0
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/health 2>/dev/null; then healthy=1; echo; break; fi
  sleep 2
done
if [[ "$healthy" -ne 1 ]]; then
  echo "Aplikace se nespustila. Poslední logy:" >&2
  docker compose logs --tail=100 app >&2
  exit 1
fi

if [[ -n "$crm_webhook_url" ]]; then
  python3 - "$crm_webhook_url" <<'PY'
import sys
import xml.etree.ElementTree as ET

template = ET.parse('integrations/3cx-service-intake-report-call.xml')
template.find('./Parameters/Parameter[@Name="WebhookUrl"]').set('Default', sys.argv[1])
template.write('integrations/3cx-service-intake-report-call.local.xml', encoding='utf-8', xml_declaration=True)
PY
  echo "CRM WebhookUrl je $crm_webhook_url"
  echo "Šablona s vyplněnou adresou je integrations/3cx-service-intake-report-call.local.xml."
fi

docker compose ps
echo
echo "Instalace dokončena. Dashboard je lokálně na http://127.0.0.1:3000/."
echo "Předání technikovi zůstává vypnuté (SERVICE_DISPATCH_ENABLED=false)."
echo "ReportCall token pro CRM šablonu 3CX je v .env: grep '^THREEX_REPORT_CALL_TOKEN=' .env"
echo "Caddy ani veřejné porty se tímto skriptem nezapínají. Pro veřejný přístup nastavte DNS, HTTPS a firewall/router."

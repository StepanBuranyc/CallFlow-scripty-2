#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Spusťte skript jako root: sudo bash ./install-3cx-host.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
if [[ ! -f install-debian.sh || ! -f compose.yaml || ! -f .env.example || ! -f deploy/3cx-service-intake.conf ]]; then
  echo "Skript musí být spuštěn z kořene projektu 3CX Service Intake." >&2
  exit 1
fi

INSTALL_DOCKER=false
if [[ "${1:-}" == "--install-docker" && $# -eq 1 ]]; then
  INSTALL_DOCKER=true
elif [[ $# -gt 0 ]]; then
  echo "Použití: sudo bash ./install-3cx-host.sh [--install-docker]" >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "Nelze ověřit distribuci Linuxu." >&2
  exit 1
fi
# shellcheck disable=SC1091
. /etc/os-release
if [[ "${ID:-}" != debian || ( "${VERSION_CODENAME:-}" != bookworm && "${VERSION_CODENAME:-}" != trixie ) ]]; then
  echo "Podporován je Debian 12 (Bookworm) nebo Debian 13 (Trixie)." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  if [[ "$INSTALL_DOCKER" != "true" ]]; then
    echo "Docker Engine s Compose pluginem není dostupný." >&2
    echo "Výchozí režim nic neinstaluje do Debianu 3CX. Pokud přijímáte nepodporovaný stav PBX, spusťte znovu s --install-docker." >&2
    exit 1
  fi
  cat >&2 <<'EOF'
VAROVÁNÍ: tento krok instaluje systémové balíčky Dockeru na hostitele 3CX.
Podle pokynů 3CX tím změníte podporovanou konfiguraci systému.
Zálohujte/snapshotujte PBX a pokračujte pouze pro testovací nasazení.
EOF
  read -r -p "Pro potvrzení napište INSTALUJI-DOCKER-NA-3CX: " CONFIRM_DOCKER
  [[ "$CONFIRM_DOCKER" == "INSTALUJI-DOCKER-NA-3CX" ]] || exit 1
  for package in docker.io docker-compose docker-compose-v2 podman-docker containerd runc; do
    if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
      echo "Nalezen balíček $package, který může kolidovat s Docker CE. Skript jej automaticky neodstraní." >&2
      echo "Vyřešte tento konflikt ručně a spusťte instalaci znovu." >&2
      exit 1
    fi
  done
  apt-get update
  apt-get install -y ca-certificates curl git openssl python3
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
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon neběží nebo není dostupný." >&2
  exit 1
fi
if [[ -f .env ]] && ! grep -Fxq 'APP_BASE_PATH=/servis' .env; then
  echo "V tomto instalační režimu musí být APP_BASE_PATH=/servis. Upravte .env a před spuštěním aplikaci znovu sestavte." >&2
  exit 1
fi
for tool in curl openssl python3 nginx; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Chybí příkaz $tool. Skript na hostiteli 3CX nebude instalovat systémové balíčky." >&2
    exit 1
  fi
done

app_id=""
if [[ -f .env ]]; then
  app_id="$(docker compose ps -q app)"
fi
if [[ -n "$app_id" && "$(docker inspect --format '{{.State.Health.Status}}' "$app_id")" == healthy ]] &&
   curl -fsS --max-time 5 http://127.0.0.1:3000/health >/dev/null; then
  app_ready=true
elif python3 - <<'PY'
import socket
s = socket.socket()
try:
    s.bind(('127.0.0.1', 3000))
except OSError:
    raise SystemExit(1)
finally:
    s.close()
PY
then
  app_ready=false
else
  echo "Port 127.0.0.1:3000 už používá jiná služba. Nic nebylo spuštěno." >&2
  exit 1
fi

AVAILABLE_KB="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)"
if [[ "$app_ready" == false ]] && (( AVAILABLE_KB < 1572864 )); then
  echo "VAROVÁNÍ: dostupná paměť je nižší než 1.5 GiB. Současný provoz 3CX a aplikace může být nestabilní." >&2
  read -r -p "Pokračovat i přesto? Napište POKRACOVAT: " CONFIRM
  [[ "$CONFIRM" == "POKRACOVAT" ]] || exit 1
fi

if [[ "$app_ready" == false ]]; then
  THREEX_HOST_MODE=true APP_BASE_PATH_DEFAULT=/servis bash ./install-debian.sh
else
  echo "Aplikace tohoto projektu už běží. Ověřuji trasu v Nginxu."
fi

source_snippet=deploy/3cx-service-intake.conf
snippet_dir=/var/lib/3cxpbx/Bin/nginx/conf/snippets
target_snippet="$snippet_dir/90-service-intake.conf"
if [[ ! -d "$snippet_dir" ]] || ! systemctl is-active --quiet nginx; then
  echo "Aplikace běží lokálně. Aktivní Nginx nebo adresář snippetů 3CX nebyl nalezen. Pro /servis/ použijte $source_snippet v HTTPS bloku 3CX." >&2
  exit 1
fi

created=false
backup=""
if [[ -e "$target_snippet" || -L "$target_snippet" ]]; then
  if ! cmp -s "$source_snippet" "$target_snippet"; then
    if [[ -L "$target_snippet" ]] || ! cmp -s "$target_snippet" <(sed 's/Host \$http_host;/Host $host;/' "$source_snippet"); then
      echo "Soubor $target_snippet má vlastní obsah. Zkontrolujte ho podle $source_snippet." >&2
      exit 1
    fi
    backup="$(mktemp "$snippet_dir/.service-intake.XXXXXX")"
    cp -p -- "$target_snippet" "$backup"
    if ! install -m 0644 "$source_snippet" "$target_snippet"; then
      mv -f -- "$backup" "$target_snippet"
      exit 1
    fi
  fi
else
  install -m 0644 "$source_snippet" "$target_snippet"
  created=true
fi

if ! nginx_config="$(nginx -T)" ||
   ! grep -Fxq "# configuration file $target_snippet:" <<< "$nginx_config" ||
   ! systemctl reload nginx; then
  if [[ "$created" == true ]]; then
    rm -f -- "$target_snippet"
  elif [[ -n "$backup" ]]; then
    mv -f -- "$backup" "$target_snippet"
  fi
  if [[ "$created" == true || -n "$backup" ]]; then
    nginx -t && systemctl reload nginx || true
  fi
  echo "Trasu /servis/ se nepodařilo aktivovat. Ověřte nginx -T a umístění include pro snippety v HTTPS bloku 3CX." >&2
  exit 1
fi

if [[ -n "$backup" ]]; then rm -f -- "$backup"; fi

echo "Nginx načetl trasu /servis/. Otevřete adresu 3CX se stejným HTTPS portem a cestou /servis/."

#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Spusťte skript jako root: sudo bash ./install-3cx-host.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
if [[ ! -f install-debian.sh || ! -f compose.yaml || ! -f .env.example ]]; then
  echo "Skript musí být spuštěn z kořene projektu 3CX Service Intake." >&2
  exit 1
fi

INSTALL_DOCKER=false
INSTALL_PORTAL_ONLY=false
BUILD_HOST_NETWORK=false
for option in "$@"; do
  case "$option" in
    --install-docker) INSTALL_DOCKER=true ;;
    --ispadmin) INSTALL_PORTAL_ONLY=true ;;
    --build-host-network) BUILD_HOST_NETWORK=true ;;
    *)
      echo "Použití: sudo bash ./install-3cx-host.sh [--ispadmin] [--build-host-network] [--install-docker]" >&2
      exit 1 ;;
  esac
done

INSTALL_APP_PREFIX=/servis
APP_HOST_PORT_DEFAULT=3000
NGINX_SNIPPET=deploy/3cx-service-intake.conf
if [[ "$INSTALL_PORTAL_ONLY" == true ]]; then
  INSTALL_APP_PREFIX=/ispadmin
  APP_HOST_PORT_DEFAULT=3001
  NGINX_SNIPPET=deploy/3cx-ispadmin.conf
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
for tool in curl openssl python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Chybí příkaz $tool. Skript na hostiteli 3CX nebude instalovat systémové balíčky." >&2
    exit 1
  fi
done

AVAILABLE_KB="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)"
if (( AVAILABLE_KB < 1572864 )); then
  echo "VAROVÁNÍ: dostupná paměť je nižší než 1.5 GiB. Současný provoz 3CX a aplikace může být nestabilní." >&2
  read -r -p "Pokračovat i přesto? Napište POKRACOVAT: " CONFIRM
  [[ "$CONFIRM" == "POKRACOVAT" ]] || exit 1
fi

echo "Instaluji pouze kontejnery aplikace a databáze. Caddy ani porty 80/443 se nespouštějí; konfigurace Nginxu 3CX se neupravuje."
THREEX_HOST_MODE=true INSTALL_APP_PREFIX="$INSTALL_APP_PREFIX" \
  INSTALL_PORTAL_ONLY="$INSTALL_PORTAL_ONLY" APP_HOST_PORT_DEFAULT="$APP_HOST_PORT_DEFAULT" \
  BUILD_HOST_NETWORK="$BUILD_HOST_NETWORK" bash ./install-debian.sh

echo "Veřejnou HTTPS cestu $INSTALL_APP_PREFIX/ připojte pomocí snippetu $NGINX_SNIPPET."

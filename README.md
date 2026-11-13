# Příjem servisních požadavků přes 3CX — OpenAI Realtime MVP

Příchozí hovor na 3CX Programmable Extension obslouží česká hlasová asistentka přes OpenAI Realtime. Stručně sesbírá jméno, volajícím potvrzené číslo pro zpětné zavolání, popis a naléhavost, přečte shrnutí a uloží požadavek do PostgreSQL až po výslovném potvrzení. Volající dostane krátké číselné číslo požadavku; po vyslovení závěrečného potvrzení aplikace hovor ukončí. Ukázkový `/test-call` endpoint zůstává oddělený laboratorní test.

## Ověřené možnosti a meze

- Aktuální průvodce 3CX popisuje Programmable Extensions jako aplikaci mimo PBX, která přijímá hovory, streamuje obousměrné audio a ovládá hovory přes Call Control API. Dokumentace aktuálně uvádí V20 Update 10; přesný build a oprávnění zákaznické PBX musíme při pilotu ověřit.
- Oficiální TypeScript SDK `@3cx/call-control-sdk` dokumentuje `CallControlClient`, `participant.getAudioStream()`, `getAudioWriter()`, `client.makeCall()`, události `participantConnected`, `participantUpdated`, `participantDisconnected` a `dtmf`. Dokumentovaný formát audia je PCM 8 kHz, 16 bit, mono. `makeCall()` může vrátit ID účastníka nebo `undefined` při přijetí požadavku HTTP 202; prototyp obsluhuje obě cesty, ale korelaci živého hovoru je nutné potvrdit na našem buildu.
- Přihlašovací údaje se vytvářejí v Admin → Integrations → API jako Service Principal s povoleným Call Control. Oprávnění rozšiřte jen na cílovou testovací klapku, až to bude pro zvolený směr hovoru potřeba.
- Volání do fronty a náhradní směrování do voicemail při výpadku aplikace nejsou v této fázi prakticky ověřené. Neměňte produkční směrování. První test proveďte pouze na izolované testovací frontě pohotovosti.
- DTMF 1 se ukládá jako potvrzení testovacího odchozího hovoru. Uložené potvrzení neznamená, že požadavek je vyřešen.

Primární zdroje:

- [3CX Programmable Extensions](https://www.3cx.com/docs/programmable-extensions/)
- [Oficiální příklady Agentic Call Control](https://github.com/3cx/agentic-call-control)
- [Oficiální TypeScript Call Control SDK](https://github.com/3cx/call-control-sdk-ts)
- [Specifikace Call Control API](https://www.3cx.com/docs/call-control-api-endpoints/)
- [Nastavení front a destinací při nezodpovězeném hovoru](https://www.3cx.com/docs/manual/call-center-queues/)
- [Oficiální instalace Docker Engine na Debian](https://docs.docker.com/engine/install/debian/)

## Použitá integrace 3CX: Programmable Extension

Aplikace se připojuje jako 3CX Programmable Extension přes Service Principal Client ID, který tvoří její RoutePoint DN. Implementace používá oficiální TypeScript balíček `@3cx/call-control-sdk`: `CallControlClient` naváže připojení k PBX, přijímá hovory a audio události na vlastním RoutePointu a zakládá odchozí hovory přes `makeCall()`.

Zákaznický hovor nejdřív zůstává v běžné 3CX frontě. Její nezodpovězená destinace se v testovacím nastavení přesměruje na Client ID této Programmable Extension. Po přijetí požadavku aplikace přes stejnou extension vede OpenAI rozhovor. Samostatné odchozí volání na `SERVICE_QUEUE_EXTENSION` je cílový další krok; dosud není automaticky spuštěno po uložení požadavku.

Aplikace nebude používat CFD/Call Flow App ani pomocný skript pro telefonní logiku. Nebude ani dotazovat tabulku agentů: pro v1 je směrovačem standardní 3CX fronta. Volání na její DN, obousměrné audio a hlasové potvrzení technika je nutné ověřit na živém testovacím buildu.

### Cílový tok požadavku a předání technikovi

1. Příchozí hovor nejprve obslouží stávající zákaznická fronta. Její nezodpovězená destinace může být nastavena na Client ID aplikace; přesné názvy a časový limit ověříme v konkrétním buildu.
2. Aplikace volajícího upozorní, že jde o virtuální asistentku, vyslechne servisní požadavek, zopakuje jej k opravě a uloží ho ještě před jakýmkoli odchozím voláním. Rozhovor a strukturované vytěžení jsou přes OpenAI; OpenAI nevybírá telefonní cíl ani nemění službu.
3. Po uložení požadavku aplikace samostatně zavolá na důvěryhodně nakonfigurovanou klapku specializované 3CX fronty pohotovosti. Tato fronta je v první verzi zdrojem dostupnosti: do fronty přihlášení technici, strategie 3CX vybere komu zazvonit. Aplikace nepřijímá cílové číslo z požadavku HTTP ani od modelu.
4. Předání se potvrdí až po hlasovém „potvrzuji“ od technika nebo po úspěšném propojení technika s volajícím. Zvednutí hovoru samo o sobě převzetí neznamená. Při nezvednutí fronty nebo chybě potvrzení aplikace zopakuje pokus podle aplikačního plánu; po vyčerpání pokusů zůstane požadavek nepřevzatý ve stavu `unassigned`.

3CX fronta podle dokumentace obsluhuje pouze agenty, kteří jsou do ní přihlášení, a nabízí polling strategie, dobu vyzvánění a maximum čekání. Programmable Extension bude volat na DN této fronty přes oficiální Call Control SDK; samotná fronta vybere přihlášeného dostupného technika. Aplikace nebude potřebovat vlastní dotaz na seznam členů fronty. Jestli hovor do fronty skutečně předá audio zprávy připojenému agentovi a jak se při tom mění identifikátor účastníka, ověříme živým testem.

Google Sheets nebude ve v1 zdrojem směrování, pokud přihlášení do fronty správně vyjadřuje službu. Pokud klient vede plán pohotovosti v tabulce a přihlášení do 3CX neodpovídá tomu, kdo má službu, přidáme samostatný serverový zdroj rozpisu a jeho API ověříme; tabulka nebude přístupná přímo modelu.

### Předběžné nastavení fronty pro pilot

Oficiální návod 3CX popisuje u fronty v `Admin Console → Call Handling → [fronta] → General` polling strategy, `Ring Time` a destinations pro nevyřízené hovory; fronta také používá svůj `Maximum queue wait time`. Pro testovací kopii fronty nastavte nezodpovězenou destinaci na Client ID programovatelné klapky a odpovídající čas čekání. Konkrétní název pole a dostupné typy destinací potvrďte v administraci daného buildu. Příchozí DID zůstává přidělen frontě; nejprve nechte frontu zkusit techniky a pak otestujte přechod na aplikaci.

Dokumentace podporuje konfiguraci takové destinace, ale nedokládá automatický fallback na voicemail, pokud je cílová aplikace vypnutá nebo odpojená. Proto v pilotu zvlášť vypněte aplikaci a zavolejte na testovací DID; zaznamenejte, zda 3CX hovor odmítne, nechá zvonit, ukončí nebo přesměruje. Do ověření použijte jen testovací frontu. Pokud fallback do nativní voicemail nebude fungovat, nastavte další mechanismus na straně 3CX (například samostatnou testovanou no-answer cestu) a prakticky ověřte její chování; žádný automatický failover zde nepředpokládáme.

## Požadavky

- Docker Engine s Docker Compose pluginem (nebo Node.js 24+ pro lokální vývoj; aktuální oficiální SDK package deklaruje Node.js >=24).
- Přístup k 3CX V20 s Call Control API, Service Principal a testovací klapka, kterou lze bezpečně volat.
- Síťové spojení hostitele aplikace na HTTPS FQDN PBX.

Aktuální aplikace byla sestavena a spuštěna na Debian serveru. Připojení k zákaznické PBX, odchozí směrování a CRM ReportCall je potřeba ověřit znovu na každém novém serveru.

## Instalace aplikace na stejný Debian jako 3CX

Tato varianta instaluje aplikaci a PostgreSQL do samostatných Docker kontejnerů na již existující 3CX Debian. Porty 80/443 ani konfiguraci Nginxu neupravuje automaticky. Aplikace poslouchá pouze na `127.0.0.1:3000`; HTTPS obslouží Nginx 3CX a použitý certifikát odpovídá FQDN ústředny. V prohlížeči bude dashboard pod `https://<FQDN-3CX>/servis/`.

**Podpora 3CX:** 3CX požaduje vyhradit Debian pro PBX, nepřidávat další balíčky a neměnit systémovou konfiguraci; změny mohou instalaci učinit nepodporovanou. Spuštění na témže hostiteli proto berte jako vědomý kompromis pro pilot. [Pokyny 3CX pro Debian](https://www.3cx.com/docs/manual/installing-debian-linux-pbx/). Pro Programmable Extensions 3CX dokumentuje aplikaci běžící mimo PBX; tato instalace ji pouze technicky spoluběží na témže stroji. [Dokumentace Programmable Extensions](https://www.3cx.com/docs/programmable-extensions/).

### 1. Připravte projekt

Přihlaste se k 3CX Debianu a stáhněte veřejný projekt přes HTTPS. Pro anonymní klonování není potřeba GitHub účet ani SSH klíč:

```sh
sudo install -d -m 0750 /opt/3cx-service-intake
sudo chown "$USER":"$USER" /opt/3cx-service-intake
git clone --depth 1 --branch main https://github.com/StepanBuranyc/CallFlow-scripty-2.git /opt/3cx-service-intake
cd /opt/3cx-service-intake
```

### 2. Nainstalujte aplikaci

Skript vyžaduje Debian 12/13, spuštěný Docker Engine s Compose pluginem a pomocné nástroje `curl`, `openssl` a `python3`. Ve výchozím stavu **neinstaluje žádné systémové balíčky**. Pokud Docker chybí, skončí bez změn. Volitelný přepínač `--install-docker` nainstaluje Docker CE a jeho závislosti z oficiálního repozitáře Dockeru; vyžaduje bezpečnostní potvrzení a mění podporovaný stav 3CX. Použijte jej jen se zálohou/snapshotem a vědomým souhlasem s tímto omezením.

```sh
cd /opt/3cx-service-intake
sudo bash ./install-3cx-host.sh
```

Pokud Docker chybí a přijímáte výše uvedený dopad:

```sh
sudo bash ./install-3cx-host.sh --install-docker
```

Skript ověří, že port `127.0.0.1:3000` není obsazený, že Docker běží, a nabídne potvrzení při nízké dostupné paměti. Pokud `.env` ještě neexistuje, ukáže průvodce pro vytvoření 3CX Service Principal a OpenAI API klíče, potom se na údaje zeptá v interaktivním dialogu. Hesla a klíče při zadávání skryje a uloží je pouze do lokálního `.env` s oprávněním `0600`. Vytvoří `.env` s `APP_BASE_PATH=/servis`, sestaví aplikaci a spustí pouze službu aplikace a databázi. Nespouští Caddy ani nepřipojuje kontejnery na host porty 80/443. Předání technikovi zůstane vypnuté, dokud jej výslovně nepovolíte.

Před instalací vytvořte v 3CX Service Principal přes `Admin → Integrations → API → Add a Service Principal`, povolte mu **Call Control API** a připravte jeho Client ID a API klíč. Configuration API/XAPI aplikace nevyužívá. Pro OpenAI vyberte API projekt na [platform.openai.com/api-keys](https://platform.openai.com/api-keys) a vytvořte tajný klíč; projekt musí mít povolený zvolený Realtime model a kvótu. API účtování je oddělené od předplatného ChatGPT ([informace o účtování](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform)). Postup 3CX popisuje [oficiální dokumentace Programmable Extensions](https://www.3cx.com/docs/programmable-extensions/).

### 3. Přidejte Nginx route 3CX

Po instalaci zkopírujte obsah `deploy/3cx-service-intake.conf` do vlastního snippet umístění používaného pro Grafanu, uvnitř stejného HTTPS `server` bloku. Snippet předává `/servis/` na `http://127.0.0.1:3000/` a ořízne prefix před předáním aplikaci. Použijte stejný ověřovací a reload postup, kterým jste nasadili Grafanu; neupravujte hlavní generovaný konfigurační soubor 3CX.

Pak ověřte:

```sh
sudo docker compose ps
curl --fail http://127.0.0.1:3000/health
sudo docker compose logs --tail=100 app
```

Otevřete `https://<FQDN-3CX>/servis/`. Instalátor připraví lokální CRM XML s adresou složenou z `PBX_BASE` a `APP_BASE_PATH`. Provoz z prohlížeče do 3CX je šifrovaný certifikátem PBX; proxy spojení z Nginxu do aplikace zůstává lokální HTTP přes loopback. Port 3000 nevystavujte do LAN ani internetu.

Pokud Nginx po úpravě konfigurace neprojde ověřením, odstraňte pouze nově přidaný snippet a použijte stejný reload postup jako před změnou. Aplikaci lze zastavit příkazem `sudo docker compose stop app db`; databázové volume zůstane zachováno. Nepoužívejte `docker compose down -v`, pokud chcete uchovat data.

## Instalace na čistý Debian 12/13

Následující postup používá oficiální APT repozitář Dockeru a Docker Compose plugin. Docker podle aktuální dokumentace podporuje Debian Bookworm 12 a Trixie 13. Příkazy spusťte pod uživatelem s `sudo`; uživatele do skupiny `docker` nepřidávejte, protože tato skupina poskytuje oprávnění srovnatelná s rootem.

### 1. Nainstalujte Docker Engine, Compose a Git

```sh
sudo apt update
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run hello-world
sudo docker compose version
```

Pokud server používá starší neoficiální Docker balíčky (`docker.io`, `docker-compose`, `containerd` nebo `runc`), nejprve ověřte, zda je lze odstranit; mohou kolidovat s balíčky Dockeru. Docker také upozorňuje, že publikované porty kontejnerů mohou obcházet pravidla UFW. Tento Compose soubor zveřejňuje administrační HTTP port pouze na `127.0.0.1`.

### 2. Zkopírujte projekt z GitHubu

Repozitář je soukromý. Na serveru předem nastavte SSH přístup k GitHubu, například read-only deploy key, a ověřte jej:

```sh
ssh -T git@github.com
sudo install -d -o "$USER" -g "$USER" /opt/3cx-service-intake
git clone git@github.com:StepanBuranyc/CallFlow-scripty-2.git /opt/3cx-service-intake
cd /opt/3cx-service-intake
```

Případně nakopírujte projekt přes SCP/rsync z počítače, na kterém máte checkout; na serveru pak přejděte do cílového adresáře projektu. Nekopírujte do něj vlastní `.env` z veřejného nebo sdíleného úložiště.

Po stažení projektu lze automatickou instalaci Dockeru, vytvoření `.env` a spuštění aplikace provést skriptem:

```sh
cd /opt/3cx-service-intake
sudo bash ./install-debian.sh
```

Skript podporuje Debian 12 a 13. Tajné údaje zadávejte do skrytých výzev; hesla pro dashboard musí mít alespoň 24 znaků. Vygeneruje nové heslo databáze i token CRM, nastaví oprávnění `.env` na `0600` a ověří endpoint `/health`. Předání technikovi zůstává vypnuté, aby šlo nejprve ověřit PBX a frontu. Pokud už `.env` existuje, skript jej nepřepíše. Dashboard zůstane dostupný jen na localhostu; Caddy a veřejné porty se automaticky nezapínají.

Pokud sestavení skončí na `EAI_AGAIN registry.npmjs.org`, ověřte přístup k registru přímo na Debianu:

```sh
getent ahosts registry.npmjs.org
curl -fsS --max-time 10 https://registry.npmjs.org/-/ping
```

Pokud oba příkazy projdou, zkuste použít síť Debianu pro sestavení:

```sh
sudo BUILD_NETWORK=host bash ./install-debian.sh
```

Na hostiteli 3CX použijte `sudo BUILD_NETWORK=host bash ./install-3cx-host.sh`. Tento režim vyžaduje, aby Docker BuildKit povoloval `network.host`. Aplikace a PostgreSQL po sestavení používají běžnou síť Compose. Pokud selže už test na Debianu, ověřte funkční DNS resolver a odchozí HTTPS v síti serveru.

Pokud je 3CX ve stejné síti a její veřejná IP z kontejneru není dostupná, nastavte interní DNS pro název z certifikátu. Stejný překlad lze nastavit přímo pro kontejner aplikace v lokálním souboru `compose.override.yaml`:

```yaml
services:
  app:
    extra_hosts:
      pbx.example.cz: "192.168.1.20"
```

Použijte skutečný název z certifikátu a interní IP vaší 3CX. V `PBX_BASE` použijte stále `https://pbx.example.cz`. Instalátor ověří HTTPS spojení z kontejneru před spuštěním služby.

### 3. Nastavte tajné údaje

```sh
cp .env.example .env
chmod 600 .env
nano .env
```

Upravte tyto hodnoty:

- `PBX_BASE` — HTTPS adresa 3CX s DNS názvem uvedeným v certifikátu, například `https://pbx.example.cz`.
- `PBX_APP_ID` a `PBX_APP_SECRET` — Client ID a API klíč Service Principal s povoleným Call Control.
- `OPENAI_API_KEY` — klíč OpenAI Realtime API; uchovávejte jej pouze v `.env`.
- `OPENAI_MODEL` — Realtime model (výchozí `gpt-realtime-2.1`); vyberte ID dostupné pro váš API projekt.
- `OPENAI_VOICE` — hlas Realtime, výchozí `alloy`.
- `COMPANY_NAME` — název společnosti, který asistentka použije při pozdravu.
- `AGENT_PROFILE` — YAML soubor scénáře pod `agents/`, bez přípony; výchozí `service-intake`.
- `AGENT_NAME` — jméno asistenta vložené do scénáře.
- `POSTGRES_PASSWORD` — nové náhodné heslo; vygenerovat lze například `openssl rand -hex 32`.
- `SERVICE_QUEUE_EXTENSION` nastavte na interní klapku testovací fronty pohotovosti. `TEST_OUTBOUND_ENABLED=false` ponechte, dokud není tato fronta potvrzená jako bezpečný testovací cíl; pak nastavte `true`.

Nepoužívejte ukázkové hodnoty. Soubor `.env` neposílejte do GitHubu a nikdy do něj nevkládejte produkční cíl volání při testování. Tento prototyp má odchozí hovory záměrně vypnuté, dokud není současně zapnutý testovací režim a nastaven allowlist.

### 4. Spusťte službu a ověřte stav

```sh
sudo docker compose up --build -d
sudo docker compose ps
curl --fail http://127.0.0.1:3000/health
sudo docker compose logs --tail=100 app
```

Healthcheck má vrátit `{"ok":true,"db":"up"}`. Aplikace sama naváže odchozí spojení na PBX; pro tento základní prototyp není potřeba vystavovat port 3000 do internetu. Odchozí testovací hovor se spouští ručně z lokálního shellu podle části „Spuštění přes Docker Compose“ níže.

Webový přehled požadavků je dostupný na `http://127.0.0.1:3000/` a obnovuje data každých 15 sekund. Port zůstává navázaný pouze na localhost. Z pracovního počítače se k němu připojte SSH tunelem, například `ssh -L 3000:127.0.0.1:3000 root@hostitel-aplikace.example.cz`, a otevřete `http://localhost:3000/`. Dashboard ukazuje stav požadavku, poslední pokus o předání a zda technik tiket potvrdil klávesou 1 nebo se spojil s volajícím klávesou 3.

Aktuální `Caddyfile` je přepnutý do dočasného testovacího režimu HTTP na portu 80, aby šel dashboard používat i bez DNS záznamu. Přenos není šifrovaný; pro skutečný provoz změňte adresu `:80` na `{$PUBLIC_DOMAIN}` a nastavte DNS i přesměrování portů 80/443. Caddy pak automaticky obstará HTTPS certifikát. Nastavte `PUBLIC_DOMAIN`, `DASHBOARD_USERNAME` a náhodné `DASHBOARD_PASSWORD` dlouhé alespoň 24 znaků. Pro první start nastavte také odlišné `ADMIN_USERNAME` a `ADMIN_PASSWORD` (alespoň 24 znaků); účty se vytvoří pouze tehdy, pokud jejich jméno v databázi ještě neexistuje. Uživatelské heslo se ukládá jako scrypt hash, nikoli v prostém textu. Správce potom může v administraci zakládat a deaktivovat účty, měnit role a hesla, spravovat stavy a naléhavost tiketů a mazat požadavky. Pracující předání technikovi nelze administrativně změnit ani smazat. Hromadné smazání vyžaduje potvrzení textem `SMAZAT`; účty ani záznamy testovacích hovorů tím smazány nejsou. Role `viewer` smí požadavky pouze prohlížet; role `admin` smí provádět administrativní změny.

DNS záznam domény musí směřovat na veřejnou IP routeru a router/firewall musí přesměrovat TCP 80 a 443 na server. Aplikace samotná zůstává publikovaná jen na localhostu; port 3000 nikdy nesměrujte přímo do internetu. Po nastavení spusťte `docker compose --profile public up -d caddy` a sledujte `docker compose logs -f caddy`. Pokud server nemá veřejně dosažitelnou IP nebo nejde nastavit port forwarding, použijte místo toho zabezpečený tunel.

Lokální spuštění stejné AI obsluhy bez Dockeru (Node.js 24+, `yarn install`, vyplněný `.env`):

```sh
yarn start:openai
```

Užitečné příkazy pro správu:

```sh
sudo docker compose logs -f app      # průběžné logy
sudo docker compose restart app      # restart aplikace
sudo docker compose down             # zastaví kontejnery, zachová volumes a data
sudo docker compose up --build -d   # znovu sestaví a spustí službu
```

Při aktualizaci stáhněte změny a znovu sestavte image:

```sh
cd /opt/3cx-service-intake
git pull --ff-only
sudo docker compose up --build -d
```

Nepoužívejte `docker compose down -v`, pokud chcete zachovat PostgreSQL i audio volume.

## Spuštění přes Docker Compose

1. Zkopírujte `.env.example` do `.env`.
2. Nastavte `PBX_BASE`, `PBX_APP_ID`, `PBX_APP_SECRET`. Vygenerujte vlastní `POSTGRES_PASSWORD` a nastavte ji také v `.env`.
3. Nastavte `SERVICE_QUEUE_EXTENSION` na přesnou interní klapku testovací fronty pohotovosti. `TEST_OUTBOUND_ENABLED=false` a `SERVICE_DISPATCH_ENABLED=false` ponechte, dokud není ověřena testovací fronta.
4. Spusťte `docker compose up --build -d`.
5. Stav ověřte `curl http://127.0.0.1:3000/health` a logy `docker compose logs -f app`.
6. Z testovací klapky zavolejte Client ID programovatelné klapky. Asistentka zahájí český rozhovor; potvrzený požadavek se uloží do tabulky `service_requests`. Ověřte zvuk oběma směry, přerušení řeči, české rozpoznávání a že se neuloží neodsouhlasené shrnutí. Použijte pouze testovací trasu.
7. Testovací odchozí hovor spusťte ručně:

```sh
curl -X POST http://127.0.0.1:3000/test-call
```

Aplikace zavolá pouze na `SERVICE_QUEUE_EXTENSION` načtené ze serverové konfigurace, přehraje vygenerovaný lokální testovací tón a čeká na DTMF `1`. Tím se testuje cesta přes frontu, nikoli výběr konkrétního technika. Výsledek lze zobrazit přes `GET /test-calls`; data jsou v PostgreSQL. Endpointy jsou dostupné jen na localhost díky mapování portu v Compose. Nepublikujte je do internetu.

Po úspěšném testovacím hovoru a potvrzení, že fronta směruje pouze na přihlášené techniky, lze zapnout `SERVICE_DISPATCH_ENABLED=true`. Po skončení rozhovoru aplikace zavolá tutéž frontu, přečte tiket, volajícího, callback, naléhavost a popis závady. Technik může říct „potvrzuji“ pro převzetí, „opakovat“ pro nové přečtení nebo „spojit s klientem“ pro volání na potvrzené callback číslo. Čísla `1`, `2` a `3` se u předání tiketu nepoužívají. Převzetí se potvrdí jednou krátkou větou a bez další volby. Při neúspěšném spojení zůstane technik na lince s asistentem a může tiket převzít bez spojení nebo zkusit spojení znovu; povoleny jsou nejvýše dva pokusy o spojení. Nezvednutý hovor na frontu nebo nepotvrzené převzetí se řeší nejvýše dvěma pokusy s minutovým odstupem; potom tiket zůstane ve stavu `unassigned`. Přehled posledních 100 tiketů je dostupný přes lokální `GET /service-requests`. Stav pokusů i výsledků spojení je v `service_request_dispatch_attempts`.

## Co ověřit společně na živé PBX

1. Zaznamenat přesný 3CX build/licenci a dostupná API oprávnění.
2. Zavolat přímo testovací Client ID a ověřit slyšitelné audio oběma směry i český AI rozhovor.
3. Ověřit, že volající může opravit přečtené údaje, že caller ID ústředny není zaměněno za callback číslo a tiket se uloží až po jeho potvrzení. Po závěrečné větě musí aplikace hovor sama ukončit.
4. Odchozí test do fronty zopakovat při neodpovědi a při hlasové schránce. Prototyp má pouze časový limit jednoho testovacího hovoru; nemá trvalé opakování ani ověření proti falešnému potvrzení ze schránky.
5. Až po úspěchu ověřit nastavení fronty a náhradní směrování při vypnuté aplikaci. Jde o oddělené chování PBX, které nemůžeme potvrdit bez přístupu k zákaznické konfiguraci.

Žádné skutečné volání ani produkční změna směrování se nespustí automaticky. Odchozí test je vypnutý ve výchozím nastavení a vyžaduje výslovné zapnutí i nastavení důvěryhodné klapky testovací fronty.

## Současný rozsah

OpenAI cestu lze spustit lokálně příkazem `yarn start:openai` po `yarn install` a nastavení `.env`; Docker spouští zkompilovaný Node server. Rozhovor a uložení tiketu jsou implementované. Tabulka `service_requests` uchovává UUID jako interní identifikátor a krátké číselné `ticket_number` od 10000 pro sdělení volajícímu. Caller ID 3CX se ukládá odděleně od callback čísla. 3CX číslo/linka se nabídne jako callback kandidát a použije se po výslovném potvrzení; pokud ho volající opraví, původní caller ID zůstává uložené odděleně a opravené číslo se uloží jako callback. Při uložení se callback normalizuje odstraněním mezer a běžných formátovacích znaků; úvodní plus zůstane zachované. Stejná normalizace se použije i při vytáčení. Callback validace vyžaduje alespoň tři číslice; při neplatném vstupu se požadavek neuloží a asistent si vyžádá nové nadiktování. Po přehrání závěrečné věty aplikace volání ukončí přes Call Control SDK. Dispatch přes frontu je řízen `SERVICE_DISPATCH_ENABLED` (ve výchozím stavu vypnuto), po dvou neúspěšných pokusech nastaví `unassigned`. Testovací `/test-call` zůstává oddělený tónový test.

Kód následuje vzor 3CX OpenAI Realtime: WebSocket `wss://api.openai.com/v1/realtime`, audio PCM mono 16-bit mezi PBX 8 kHz a OpenAI 24 kHz, server VAD, český přepis a zvuková odpověď. Vstupní audio používá `near_field` potlačení šumu a VAD threshold 0.6, aby se omezilo spouštění na okolní hluk. Pokud potlačení zeslabí tichého volajícího, upravte `strength` nebo threshold v `src/openai-realtime.ts`. 3CX caller ID, linka a rozpoznané jméno se asistentce předávají pouze pro identifikaci a úvodní ověření; callback číslo se získává zvlášť. Scénář je v `agents/service-intake.yaml`: `role` stručně pojmenovává roli, `prompt` obsahuje systémová pravidla rozhovoru a `greeting` první větu. V `voice` a `speed` lze nastavit Realtime hlas a rychlost řeči. Vybraný soubor určuje `AGENT_PROFILE` v `.env`. Model smí vyvolat pouze `save_service_request`; cílovou frontu ani číslo nemůže určit. Živý hovor na zákaznické PBX je nutné před pilotem ověřit.

## Historie hovorů 3CX a nahrávky u tiketu

Projekt obsahuje CRM šablonu [`integrations/3cx-service-intake-report-call.xml`](integrations/3cx-service-intake-report-call.xml). V 3CX ji přidejte v `Admin → Integrations → CRM` jako vlastní CRM integraci a zapněte call journaling pro příchozí i odchozí hovory. Šablona po skončení hovoru zavolá `POST /integrations/3cx/report-call` a předá číslo, směr, čas, frontu, technika a `RecordingUrl`. CRM ReportCall podle dokumentace 3CX eviduje externí hovory; hovory techniků se zákazníky mimo tuto aplikaci se tak mohou připojit ke správnému tiketu. Hovory vedené aplikací mají navíc vlastní historii pokusů o předání.

Pokud instalátor vytvořil `integrations/3cx-service-intake-report-call.local.xml`, importujte tento soubor. Na samostatném Debianu se URL vyplní z `CRM_PUBLIC_ORIGIN` a `APP_BASE_PATH`. V základní šabloně nastavte `WebhookUrl` přímo v administraci 3CX.

Vygenerujte samostatný náhodný token (alespoň 32 znaků), nastavte jej jako `THREEX_REPORT_CALL_TOKEN` v serverovém `.env` a stejnou hodnotu vložte do parametru `WebhookToken` v CRM integraci. `WebhookUrl` nastavte na adresu aplikace dosažitelnou z 3CX. Pokud aplikace běží v kořeni webu, použijte například `https://<FQDN-APLIKACE>/integrations/3cx/report-call`; pokud je pod prefixem, zahrňte jej, například `https://<FQDN-3CX>/servis/integrations/3cx/report-call`. Pro dočasný test v důvěryhodné místní síti lze použít `http://<IP-ADRESA-SERVERU>/integrations/3cx/report-call`, případně doplnit prefix podle nastavení aplikace. Token neposílejte přes veřejnou nešifrovanou HTTP síť; pro běžný provoz použijte HTTPS. Po úpravě `.env` aplikaci znovu sestavte a spusťte (`docker compose up --build -d app`).

Hovor se přiřadí automaticky podle čísla a času tiketu, případně podle jediného otevřeného tiketu s tímto číslem. Pokud shoda není jednoznačná, správce jej přiřadí v Administraci → Nepřiřazené hovory z 3CX. U tiketu uživatelé uvidí metadata a přehrávač nahrávky, pokud ji 3CX poskytne a prohlížeč se k `RecordingUrl` dostane. Nahrávání hovorů musí být povoleno v 3CX. Interní hovory pouze mezi klapkami nejsou v CRM ReportCall podporovány; pro jejich metadata by bylo nutné zapojit samostatný 3CX CDR zdroj. Přímý přístup aplikace do databáze 3CX se nepoužívá.

### Srovnání hlasu OpenAI a Grok

V administraci v části Poskytovatel hlasu zadejte klíč xAI a zvolte Grok Voice. Změna se projeví při dalším příchozím hovoru. Volba OpenAI Realtime vrátí původní trasu. Oba poskytovatelé používají společný pozdrav, prompt i nástroj pro zápis tiketu. Hlas Grok se nastavuje samostatně. Nastavení tempa a předání technikovi používají OpenAI.

Pro ukázku zavolejte se stejnou fiktivní závadou, jménem a callbackem, jednou číslo opravte a u obou hovorů porovnejte českou výslovnost, čas do pozdravu a správnost tiketu. Integrace Grok vychází z [oficiálního příkladu 3CX](https://github.com/3cx/agentic-call-control/tree/master/examples/xai-realtime).

Klíče zadané v administraci se ukládají šifrovaně. Před prvním uložením nastavte stabilní `VOICE_SECRETS_KEY` (například výstup `openssl rand -hex 32`). Pokud chybí, použije se `PBX_APP_SECRET`. Při obnově databáze uchovejte stejné šifrovací tajemství. Klíč zadaný v administraci má přednost před `OPENAI_API_KEY` v prostředí.

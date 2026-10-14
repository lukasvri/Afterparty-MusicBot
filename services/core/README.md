# Gutta Krutt Core 2.0.1

Sjølvhosta Discord-bot og sanntidsmotor. Sjå [hovudrettleiinga](../../README.md) for oppsett, nøklar, nettside og testar, og [driftsnotata](PUBLIC_RELEASE.md) for serverisolasjon og gjenoppretting.

```sh
cp .env.example .env
# Fyll ut eigne verdiar.
docker compose build
docker compose up -d
./core-control.sh status
```

Data ligg i Compose-volumet `core-data`, montert på `/data`. Nye Discord-serverar får databasar under `/data/guilds/`. Port 3990 er berre bunden til loopback. Administrasjon skjer på nettsida si `/admin`-rute.

`./core-control.sh start|stop|status|logs|admin` brukar Docker-konteksten `default`. `start` byggjer ikkje ny kode; bygg eksplisitt ved oppgradering. Bevar førre Core-bilete og ta konsistent backup av heile datavolumet før eit byte.

Core brukar ikkje Muse som runtime. Referansekode med Muse-lisens er bevart under `reference/muse/`. Tilbakeføring frå denne motoren krev ein kompatibel Core-versjon, ikkje ein eldre Muse-installasjon.

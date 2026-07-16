# Dokumentacja LumaShell

LumaShell to szybki, konfigurowalny terminal dla Windows oparty na Electronie,
z obsługą SSH, portów szeregowych, wtyczek i wbudowanego agenta AI.

Ten katalog zawiera plan projektu rozbity na dokumenty tematyczne.
Na tym etapie jest to **dokumentacja projektowa, a nie opis istniejącej implementacji** —
repozytorium zawiera strukturę katalogów i plan, bez kodu.

## Architektura

| Dokument | Zakres |
| --- | --- |
| [01 — Założenia i stos technologiczny](architecture/01-zalozenia-i-stos.md) | Cele projektu, wybór technologii, silnik terminala, dystrybucja |
| [02 — Warstwy i transporty](architecture/02-warstwy-i-transporty.md) | Podział na procesy, abstrakcja połączeń, obsługiwane protokoły |
| [03 — Interfejs i motywy](architecture/03-interfejs-i-motywy.md) | Układ UI, styl glassmorphism, paleta, system motywów |
| [04 — Profile i funkcje terminala](architecture/04-profile-i-funkcje.md) | Profile połączeń, standardowe funkcje terminala |
| [05 — Wydajność](architecture/05-wydajnosc.md) | Optymalizacja Electrona, cele wydajnościowe |
| [06 — Struktura projektu](architecture/06-struktura-projektu.md) | Układ katalogów repozytorium |
| [07 — Testy](architecture/07-testy.md) | Testy jednostkowe, integracyjne, E2E, wydajnościowe |
| [08 — Roadmapa](architecture/08-roadmapa.md) | Etapy realizacji, zakres MVP, zakres 1.0 |
| [09 — Agent AI](architecture/09-agent-ai.md) | Tryby integracji z AI, architektura agenta, panel, kontekst, pamięć |

## Plugin API

| Dokument | Zakres |
| --- | --- |
| [01 — Przegląd i manifest](plugin-api/01-przeglad-i-manifest.md) | Format wtyczki, manifest, API, możliwości rozszerzeń |
| [02 — Uprawnienia i izolacja](plugin-api/02-uprawnienia-i-izolacja.md) | Model uprawnień, Plugin Host, izolacja |
| [03 — Narzędzia agenta](plugin-api/03-narzedzia-agenta.md) | Protokół narzędzi, rejestracja narzędzi przez wtyczki |

## Bezpieczeństwo

| Dokument | Zakres |
| --- | --- |
| [01 — Model procesów](security/01-model-procesow.md) | Izolacja renderera, IPC, zasady Electrona |
| [02 — Sekrety](security/02-sekrety.md) | Hasła, klucze SSH, klucze API, filtr sekretów |
| [03 — Polityka agenta](security/03-polityka-agenta.md) | Narzędzia agenta, tryby autonomii, zabezpieczenia UART |
| [04 — Audyt](security/04-audyt.md) | Rejestrowanie działań agenta, kontrola użytkownika |

## Priorytety projektu

1. Szybkość działania terminala
2. Stabilność połączeń
3. Bezpieczeństwo procesu Electron
4. Ograniczenie zużycia pamięci
5. Pełna personalizacja
6. Spójny ciemno-zielony styl glass
7. Bezpieczny i dobrze udokumentowany system wtyczek

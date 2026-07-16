# Agent AI

## 1. Główne założenie

Terminal posiada wbudowany panel agenta AI, który może:

* analizować dane wyświetlane w terminalu,
* proponować polecenia,
* wykonywać zatwierdzone polecenia,
* korzystać z aktywnych sesji terminalowych,
* komunikować się przez SSH,
* obsługiwać porty szeregowe COM/UART,
* analizować dane tekstowe i binarne,
* wykonywać wieloetapowe zadania,
* korzystać z narzędzi dostarczanych przez wtyczki,
* modyfikować pliki w wybranych katalogach,
* uruchamiać kompilację, testy i diagnostykę.

Funkcjonalnie przypomina to połączenie terminala, ChatGPT, agenta Codex, command palette
oraz systemu narzędzi podobnego do MCP.

> **Agent nie otrzymuje automatycznie pełnego dostępu do całego systemu.**
> Politykę dostępu opisuje [security/03 — Polityka agenta](../security/03-polityka-agenta.md).

## 2. Ograniczenie dotyczące konta ChatGPT

Subskrypcja ChatGPT Plus **nie obejmuje** standardowego użycia OpenAI API. Użycie API jest
rozliczane osobno. To samo rozdzielenie dotyczy planów ChatGPT Business i Enterprise.

Aplikacja **nie może zakładać**, że użytkownik:

1. loguje się zwykłym kontem ChatGPT,
2. ma aktywny plan Plus,
3. może dzięki temu bez ograniczeń wywoływać modele z własnej aplikacji.

Oficjalny Codex jest wyjątkiem produktowym: Codex może być dostępny w planach ChatGPT,
a oficjalny Codex CLI obsługuje logowanie kontem ChatGPT.

Dlatego terminal obsługuje kilka niezależnych sposobów połączenia z AI.

## 3. Tryby integracji

### Tryb A — OpenAI API

Podstawowy i najbardziej przewidywalny sposób implementacji.

Użytkownik:

* podaje własny klucz API,
* wybiera projekt lub organizację OpenAI,
* ponosi koszty użycia API,
* ustawia limity wydatków,
* wybiera dostępne modele.

**Zalety:** oficjalne i stabilne API, pełna kontrola nad wywołaniami modeli, własny system
narzędzi, możliwość definiowania niestandardowych agentów, dokładne raportowanie kosztów,
łatwiejsza integracja z SSH, UART i wtyczkami.

**Wady:** osobne rozliczanie, konieczność konfiguracji API przez użytkownika, wymóg
bezpiecznego przechowywania klucza ([security/02 — Sekrety](../security/02-sekrety.md)).

### Tryb B — oficjalny Codex CLI

Aplikacja może pozwalać na korzystanie z oficjalnie zainstalowanego Codex CLI. Codex CLI
działa lokalnie w terminalu, może analizować repozytorium, modyfikować pliki oraz
uruchamiać polecenia. Obsługuje logowanie kontem ChatGPT albo konfigurację przez API.

Terminal udostępnia funkcję:

```text
AI → Połącz z Codex CLI
```

Aplikacja powinna wtedy:

1. wykryć oficjalną instalację Codex CLI,
2. pozwolić użytkownikowi wykonać oficjalny proces logowania,
3. uruchamiać Codex jako osobny proces,
4. wyświetlać jego interfejs albo komunikaty w panelu aplikacji,
5. **nie odczytywać ani nie kopiować tokenów logowania Codex**,
6. **nie podszywać się pod oficjalnego klienta OpenAI**.

Codex należy traktować jako osobny komponent, a nie nieudokumentowany backend aplikacji.

### Tryb C — lokalny model AI

Wsparcie lokalnych modeli przez:

* Ollama,
* LM Studio,
* lokalny serwer zgodny z API OpenAI,
* własny endpoint HTTP.

Ten tryb działa bez konta OpenAI. Nadaje się do prywatnych danych, pracy offline, prostego
generowania poleceń, analizy logów i automatyzacji urządzeń lokalnych. Jakość wykonywania
skomplikowanych zadań zależy od wybranego modelu i możliwości komputera.

### Tryb D — własny dostawca zgodny z API

Architektura nie jest sztywno związana z OpenAI. Wspólny interfejs:

```ts
export interface AiProvider {
  id: string;
  name: string;

  isConfigured(): Promise<boolean>;
  authenticate(): Promise<void>;
  disconnect(): Promise<void>;

  createAgent(options: AgentOptions): Promise<AgentSession>;
  listModels(): Promise<AiModel[]>;
}
```

Implementacje:

```text
OpenAiApiProvider
CodexCliProvider
LocalModelProvider
OpenAiCompatibleProvider
```

## 4. Architektura agenta

```text
┌───────────────────────────────────────────────┐
│                Panel czatu AI                 │
│ rozmowa, plan, podgląd działań, zatwierdzanie │
├───────────────────────────────────────────────┤
│                 Agent Runtime                 │
│ kontekst, planowanie, narzędzia, historia     │
├───────────────────────────────────────────────┤
│                 Policy Engine                 │
│ uprawnienia, zgody, limity, blokady           │
├───────────────────────────────────────────────┤
│                  Tool Router                  │
│ PTY │ SSH │ UART │ pliki │ procesy │ wtyczki  │
├───────────────────────────────────────────────┤
│                Session Services               │
│ terminale, porty COM, hosty, workspace        │
├───────────────────────────────────────────────┤
│                   AI Provider                 │
│ OpenAI API │ Codex CLI │ model lokalny        │
└───────────────────────────────────────────────┘
```

Agent działa w osobnym procesie lub w Electron `UtilityProcess`.

Agent **nie działa**:

* w rendererze,
* w głównym procesie Electron,
* w procesie odpowiedzialnym za interfejs,
* z pełnym dostępem do modułów Node.js.

## 5. Interfejs panelu AI

Panel zawiera:

* historię rozmowy,
* wybór modelu lub dostawcy,
* wybór trybu autonomii,
* listę dostępnych narzędzi,
* zakres aktywnego workspace’u,
* wskaźnik użycia modelu,
* historię wykonanych działań,
* przyciski zatrzymania i przerwania zadania,
* podgląd planu,
* podgląd poleceń przed wykonaniem,
* podgląd zmian w plikach,
* log wywołań narzędzi.

### Przykładowy układ

```text
┌───────────────────────────────────────────────┐
│ Agent AI                   GPT / Codex / Local│
├───────────────────────────────────────────────┤
│ Zadanie: sprawdź urządzenie na COM4           │
│                                               │
│ Plan                                          │
│ ✓ Otwórzono COM4                              │
│ ✓ Odczytano komunikat startowy                │
│ → Wyślij komendę diagnostyczną                │
│ ○ Przeanalizuj odpowiedź                      │
│                                               │
│ Wymagane potwierdzenie                        │
│ serial.writeText(COM4, "diagnostics\r\n")     │
│                                               │
│ [Zezwól] [Edytuj] [Odrzuć]                    │
├───────────────────────────────────────────────┤
│ Zapytaj agenta…                               │
└───────────────────────────────────────────────┘
```

## 6. Kontekst przekazywany do modelu

Do modelu należy wysyłać **wyłącznie dane potrzebne do wykonania zadania**.

Możliwy kontekst:

* ostatnie linie aktywnego terminala,
* zaznaczony fragment tekstu,
* wybrane pliki,
* struktura workspace’u,
* informacje o aktywnej sesji,
* jawnie udostępniona dokumentacja urządzenia,
* lista dostępnych narzędzi.

**Nie należy automatycznie wysyłać:**

* całej historii terminala,
* wszystkich plików użytkownika,
* zawartości schowka,
* haseł,
* kluczy prywatnych,
* tokenów,
* zmiennych środowiskowych zawierających sekrety,
* danych z innych sesji.

Przed wysłaniem kontekstu działa filtr sekretów — opis:
[security/02 — Sekrety](../security/02-sekrety.md).

## 7. Pamięć agenta

### Pamięć rozmowy

Dotyczy bieżącego czatu.

### Pamięć workspace’u

Może zawierać:

* sposób budowania projektu,
* używane komendy,
* architekturę repozytorium,
* opis urządzenia,
* parametry UART,
* zaakceptowane procedury diagnostyczne.

### Pamięć globalna

Opcjonalna i domyślnie ograniczona.

**Nie należy zapisywać:** haseł, tokenów, pełnych logów zawierających dane wrażliwe,
prywatnych kluczy, przypadkowo wykrytych sekretów.

## 8. Przykładowe scenariusze

### Diagnostyka UART

> Sprawdź, dlaczego urządzenie podłączone do COM4 się restartuje.

1. Agent prosi o dostęp do COM4.
2. Odczytuje log startowy.
3. Rozpoznaje komunikat watchdog.
4. Proponuje włączenie bardziej szczegółowego logowania.
5. Wysyła komendę po zatwierdzeniu.
6. Zbiera dane.
7. Przedstawia diagnozę.

### Kompilacja i flashowanie

> Zbuduj firmware i wgraj go na urządzenie.

1. Agent analizuje projekt.
2. Uruchamia kompilację.
3. Analizuje błędy.
4. Poprawia kod po zatwierdzeniu zmian.
5. Ponownie buduje projekt.
6. Wykrywa urządzenie.
7. Pokazuje firmware, urządzenie i komendę flashowania.
8. Wymaga osobnego potwierdzenia.
9. Przeprowadza flashowanie.
10. Monitoruje UART po restarcie.

### Diagnostyka serwera

> Połącz się z serwerem testowym i sprawdź, czemu usługa nie działa.

1. Agent korzysta z istniejącego profilu SSH.
2. Prosi o zgodę na połączenie.
3. Odczytuje status usługi.
4. Analizuje logi.
5. Proponuje poprawkę.
6. Wymaga potwierdzenia przed restartem usługi.

## 9. Rekomendacja końcowa

Terminal powinien obsługiwać dwa główne warianty OpenAI:

```text
1. OpenAI API
   → własny klucz API użytkownika
   → osobne rozliczanie
   → pełna integracja z narzędziami terminala

2. Oficjalny Codex CLI
   → logowanie kontem ChatGPT
   → wykorzystanie oficjalnego procesu Codex
   → bez przejmowania tokenów i nieudokumentowanych endpointów
```

**Nie należy budować integracji polegającej na:**

* kopiowaniu ciasteczek z ChatGPT,
* przechwytywaniu tokenów przeglądarki,
* wywoływaniu prywatnych endpointów ChatGPT,
* podszywaniu się pod Codex CLI,
* obchodzeniu rozliczeń OpenAI.

Docelowy wybór użytkownika:

```text
Dostawca AI:
○ OpenAI API
○ Codex CLI — konto ChatGPT
○ Model lokalny
○ Własny endpoint
```

> Najważniejszą częścią tej funkcji nie jest sam panel czatu, lecz **bezpieczna warstwa
> narzędzi**. Agent powinien otrzymywać precyzyjnie ograniczone funkcje, takie jak
> `terminal.writeInput` lub `serial.writeText`, zamiast nieograniczonego dostępu do Node.js
> i systemu operacyjnego.

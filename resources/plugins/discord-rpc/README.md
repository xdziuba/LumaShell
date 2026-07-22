# Discord Rich Presence

Pokazuje w Discordzie, że pracujesz w LumaShellu: nazwę aplikacji, logo, nazwę otwartej
zakładki i licznik czasu sesji.

To jest wtyczka referencyjna Plugin API v2 — cały transport (nazwany potok Discorda) to
`node:net` w procesie wtyczki. Aplikacja nie dostała ani jednej linii API „do gniazd".

## Co musisz zrobić raz

Rich Presence wymaga aplikacji założonej w Discordzie — bez jej identyfikatora Discord
odrzuci połączenie. To wymóg Discorda, nie LumaShella.

1. Wejdź na <https://discord.com/developers/applications> i kliknij **New Application**.
   Nazwa aplikacji to tekst, który Discord pokaże jako „Gra w …", więc wpisz `LumaShell`.
2. Skopiuj **Application ID** z zakładki *General Information*.
3. W zakładce *Rich Presence → Art Assets* wgraj obrazek i nazwij go dokładnie
   **`lumashell`** — pod tym kluczem wtyczka prosi o duże logo. Bez tego status pojawi się
   bez ikony (reszta działa).
4. Włącz wtyczkę w LumaShellu (**Wtyczki → Discord Rich Presence → Włączona**). Przy
   pierwszym uruchomieniu bez identyfikatora wtyczka pokaże powiadomienie ze ścieżką pliku
   ustawień.
5. Wpisz identyfikator do tego pliku:

```json
{ "clientId": "1234567890123456789" }
```

Plik leży w `%APPDATA%\lumashell\plugins-data\com.lumashell.discord-rpc.json`.

6. Uruchom komendę **„Discord: połącz ponownie"** z palety (Ctrl+Shift+P) — albo przeładuj
   wtyczkę w menedżerze.

## Komendy

| Komenda | Co robi |
| --- | --- |
| `Discord: pokaż stan połączenia` | mówi, czy jest połączenie, a jak nie ma — dlaczego |
| `Discord: przełącz pokazywanie nazw zakładek` | patrz „Prywatność" |
| `Discord: połącz ponownie` | wymusza próbę połączenia bez czekania na ponowienie |

## Prywatność

Nazwa zakładki bywa nazwą hosta SSH (`root@prod-db-01`), a status Discorda widzą inni.
Dlatego pokazywanie nazw da się wyłączyć jedną komendą — wtedy w statusie jest samo
„Terminal". Ustawienie przeżywa restart.

Wtyczka łączy się **wyłącznie** z lokalnym Discordem przez nazwany potok. Nic nie wychodzi
do internetu; LumaShell nie wysyła nigdzie zawartości terminala.

## Jak to działa

Protokół Discord IPC: ramka to `op(uint32 LE) + długość(uint32 LE) + JSON`. Po połączeniu
z `\\.\pipe\discord-ipc-N` (Windows) leci `HANDSHAKE` z `client_id`, a Discord odpowiada
zdarzeniem `READY`. Status ustawia się ramką `SET_ACTIVITY`.

Szczegóły, na które trzeba uważać przy własnej implementacji:

* potok tnie dane dowolnie — parser musi składać ramki z porcji, a nie zakładać, że jedna
  porcja to jedna ramka,
* Discord przycina zbyt częste aktualizacje, więc wysyłka jest ograniczona do jednej na
  15 sekund (pierwsza zmiana po ciszy idzie od razu),
* Discord bywa wyłączony godzinami — ponawianie ma backoff z sufitem 60 s,
* `deactivate()` czyści status, żeby po wyłączeniu wtyczki nie wisiał do timeoutu Discorda.

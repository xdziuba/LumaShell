# Audyt

## 1. Rejestrowanie działań

**Każda akcja agenta jest widoczna w historii.**

```text
14:31:02  Agent odczytał 120 linii z COM4
14:31:05  Agent zaproponował: status\r\n
14:31:08  Użytkownik zatwierdził operację
14:31:08  Wysłano 8 bajtów do COM4
14:31:09  Odebrano 384 bajty
14:31:10  Agent przeanalizował odpowiedź
```

## 2. Zawartość wpisu

Każde wykonanie narzędzia rejestruje:

* identyfikator zadania,
* identyfikator sesji agenta,
* identyfikator użytkownika,
* nazwę narzędzia,
* argumenty,
* poziom ryzyka,
* wynik,
* czas rozpoczęcia i zakończenia,
* informację o zgodzie użytkownika.

## 3. Kontrola użytkownika

Użytkownik może:

* zatrzymać agenta,
* cofnąć udzielone uprawnienie,
* wyeksportować raport działań,
* wyczyścić historię,
* sprawdzić, jakie dane wysłano do modelu,
* sprawdzić koszty lub zużycie.

Panel AI zawiera **przycisk natychmiastowego zatrzymania agenta** — element zakresu MVP,
patrz [architecture/08 — Roadmapa](../architecture/08-roadmapa.md).

## 4. Ograniczenia zapisu

Dziennik audytowy nie może zawierać sekretów. Zasady filtrowania:
[security/02 — Sekrety](02-sekrety.md).

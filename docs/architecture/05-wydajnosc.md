# Wydajność

Mimo zastosowania Electrona aplikacja jest projektowana jako lekka.

## 1. Najważniejsze zasady

* jedno główne okno zamiast osobnego okna dla każdej sesji,
* ograniczona liczba rendererów,
* brak ciężkich bibliotek, gdy nie są potrzebne,
* lazy loading paneli i ustawień,
* dynamiczne ładowanie wtyczek,
* wyłączanie nieaktywnych animacji,
* wirtualizacja długich list,
* ograniczenie liczby elementów DOM,
* WebGL dla terminala,
* buforowanie konfiguracji,
* przeniesienie ciężkich operacji do Worker Threads,
* niewczytywanie wszystkich wtyczek podczas startu,
* ograniczanie częstotliwości aktualizacji UI,
* grupowanie danych wysyłanych przez IPC.

## 2. Zarządzanie terminalami

Nieaktywne zakładki powinny:

* ograniczać renderowanie,
* nie wykonywać animacji,
* aktualizować bufor bez przerysowywania całego terminala,
* być renderowane dopiero po ponownym aktywowaniu.

## 3. Wykrywanie powłok

Wykrywanie jest **leniwe i zapamiętywane**: uruchamia się na pierwsze żądanie, nie przy
starcie aplikacji, a wynik jest cache'owany. Powód jest konkretny — lista dystrybucji WSL
wymaga odpalenia `wsl.exe`, więc powtarzanie tego przy każdej nowej sesji byłoby
marnotrawstwem.

> **Zimny start WSL trwa kilkanaście sekund.** Zmierzone: prompt Ubuntu pojawia się
> długo po tym, jak sesja została utworzona. Sesja wstaje od razu, ale terminal jest przez
> ten czas pusty — to zachowanie WSL, nie aplikacji. Warto to kiedyś obsłużyć w interfejsie
> (wskaźnik rozruchu), bo pusty czarny prostokąt wygląda jak awaria.

## 4. Czas startu

Podczas uruchamiania należy najpierw załadować:

* główne okno,
* podstawowy motyw,
* ostatni workspace,
* minimalną konfigurację.

Dopiero później:

* wtyczki,
* historię,
* dodatkowe panele,
* aktualizacje,
* integracje zewnętrzne.

## 5. Cele wydajnościowe

Realistyczne cele dla aplikacji Electron:

* szybkie wyświetlenie głównego okna,
* pełna gotowość aplikacji w około 1–2 sekundy na typowym komputerze,
* stabilne 60 FPS podczas normalnego użytkowania,
* brak blokowania interfejsu podczas odbioru danych,
* płynna obsługa wielu aktywnych terminali,
* kontrolowane zużycie pamięci,
* możliwość wyłączenia efektów wizualnych,
* automatyczne ograniczanie renderowania nieaktywnych sesji.

Electron nie będzie tak lekki jak aplikacja napisana w czystym C++, ale dzięki
odpowiedniej architekturze może pozostać szybki i responsywny.

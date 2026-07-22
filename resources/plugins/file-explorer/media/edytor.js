// Edytor pliku — strona widoku wtyczki (webview).
//
// Nie ma tu dostępu do plików: ramka nie ma Node ani sieci. Wszystko idzie przez most
// dostarczony przez aplikację (`/__luma/api.js`) do PROCESU wtyczki, który dopiero czyta
// i zapisuje dysk. Dzięki temu granica jest w jednym miejscu, a nie rozmyta po stronie.

const luma = window.acquireLumaApi();

const poleSciezki = document.getElementById('sciezka');
const poleStanu = document.getElementById('stan');
const przyciskZapisz = document.getElementById('zapisz');
const pole = document.getElementById('tresc');

let biezacyPlik = null;
let oryginal = '';

function ustawStan(tekst, klasa) {
  poleStanu.textContent = tekst;
  poleStanu.className = `stan${klasa ? ` ${klasa}` : ''}`;
}

function odswiezPrzyciski() {
  const zmieniony = biezacyPlik !== null && pole.value !== oryginal;
  przyciskZapisz.disabled = !zmieniony;
  if (biezacyPlik === null) ustawStan('', '');
  else if (zmieniony) ustawStan('niezapisane zmiany', 'zmieniony');
}

pole.addEventListener('input', odswiezPrzyciski);

przyciskZapisz.addEventListener('click', () => {
  if (biezacyPlik === null) return;
  ustawStan('zapisywanie…', '');
  luma.post({ typ: 'zapisz', sciezka: biezacyPlik, tresc: pole.value });
});

// Ctrl+S — odruch, którego wszyscy próbują w edytorze.
window.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (!przyciskZapisz.disabled) przyciskZapisz.click();
  }
});

luma.onMessage((wiadomosc) => {
  if (!wiadomosc || typeof wiadomosc !== 'object') return;

  if (wiadomosc.typ === 'otworz') {
    biezacyPlik = wiadomosc.sciezka;
    oryginal = wiadomosc.tresc ?? '';
    poleSciezki.textContent = wiadomosc.sciezka;
    pole.value = oryginal;
    pole.disabled = false;
    ustawStan('', '');
    odswiezPrzyciski();
    pole.focus();
  } else if (wiadomosc.typ === 'zapisano') {
    oryginal = pole.value;
    ustawStan('zapisano', 'zapisany');
    odswiezPrzyciski();
  } else if (wiadomosc.typ === 'blad') {
    ustawStan(wiadomosc.komunikat ?? 'błąd', 'zmieniony');
  }
});

// Powiedz wtyczce, że strona jest gotowa — mogła zostać otwarta później niż plik wybrany.
luma.post({ typ: 'gotowy' });

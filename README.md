# Agenda Frizerie 5.0.17 — Android și iPhone

Programări, clienți, servicii și rapoarte, cu date locale și backup/sincronizare Firebase.

## Activare

Fiecare instalare cere PIN-ul de activare la prima deschidere. PIN-ul este verificat prin serviciul HTTPS separat; în aplicație se păstrează numai o confirmare semnată, legată de acea instalare. PIN-ul nu este inclus în surse și nu este păstrat local.

Activarea se păstrează la actualizări și permite redeschiderea fără internet. Ștergerea stocării sau reinstalarea poate necesita o nouă activare. Confirmarea are valabilitate de zece ani, la fel ca mecanismul de referință; nu implică reconectări frecvente.

Activarea este separată de contul aplicației Firebase și de Google Drive. Nu înlocuiește drepturile Firebase și nu cere parola Google. Confirmarea activării nu intră în backupurile sau sincronizarea agendei.

## Instalare și actualizare

Android 5.0.17 actualizează edițiile 5.0.15 și 5.0.16 cu același identificator și certificat personal. Verificarea automată zilnică anunță o versiune disponibilă. Butonul Descarcă deschide fișierul APK publicat pe GitHub în browser; utilizatorul deschide descărcarea și confirmă actualizarea în Android. Permisiunea REQUEST_INSTALL_PACKAGES și instalatorul intern au fost eliminate. Edițiile Android 5.0.14 și anterioare folosesc vechea identitate. Pentru transferul unei agende din acele ediții, exportă întâi o copie de siguranță și import-o în ediția curentă.

Pe iPhone, folosește pictograma deja instalată și alege Setări → Verifică actualizările → Actualizează aplicația. Agenda, setările și activarea se păstrează. Actualizarea se aplică direct, fără o procedură obligatorie de export și import al backupului.

La deschidere, browserul verifică serviciul de actualizare. După descărcarea completă a unei ediții noi apare butonul Actualizează. Aplicarea în sesiunea deschisă necesită confirmarea utilizatorului și așteaptă închiderea formularelor și salvarea datelor. După închiderea tuturor ferestrelor vechi, browserul poate activa ediția complet descărcată la următoarea deschidere. Verificarea manuală rămâne disponibilă. Browserul gestionează momentul reîmprospătării pictogramei salvate pe ecranul principal.

[Ghid de instalare (PDF)](docs/ghid-instalare.pdf) · [Ghid de utilizare (PDF)](docs/ghid-utilizare.pdf)

Pagina comună: https://caiuspoputa-debug.github.io/aplicatii/
Aplicația iPhone: https://caiuspoputa-debug.github.io/tool-upload-iphone/

## Date, logo și backup

Instalările noi pornesc fără logo. La actualizarea unei aplicații existente se păstrează logo-ul curent, inclusiv portretul implicit anterior. Migrarea salvează logo-ul prin fluxul normal al agendei, pentru a-l păstra și în backup/sincronizare; un logo personalizat sau o alegere explicită fără logo rămân neschimbate. Logo-ul se schimbă din Setări. Programările noi se creează doar în așteptare sau confirmate; celelalte stări se aplică celor existente. Importurile istorice păstrează toate stările.

Firebase este pe planul Spark. Backupul se face aproximativ la un minut după modificări, cu aplicația deschisă, conectată și online; sunt păstrate ultimele șapte zile cu backup. Exportul local și backupul Google Drive rămân disponibile. Nu este garantată executarea cu aplicația închisă.

## Publicare și istoric

Sursele curente și versiunea de instalare protejată folosesc aceleași adrese publice. Versiunile anterioare fără activare și istoricul lor sunt păstrate într-o arhivă privată. Copiile deja descărcate și pregătite offline nu pot fi dezactivate prin schimbarea vizibilității GitHub.

## Verificare

Testele folosesc date și chei sintetice, servicii simulate și emulator Firebase local; nu folosesc PIN-ul real sau agenda utilizatorului. Testul pe telefoane fizice și activarea reală se fac după publicare.

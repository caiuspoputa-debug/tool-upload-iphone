# Agenda Frizerie 5.0.15 — Android și iPhone

Programări, clienți, servicii și rapoarte, cu date locale și backup/sincronizare Firebase.

## Activare

Fiecare instalare cere PIN-ul de activare la prima deschidere. PIN-ul este verificat prin serviciul HTTPS separat; în aplicație se păstrează numai o confirmare semnată, legată de acea instalare. PIN-ul nu este inclus în surse și nu este păstrat local.

Activarea se păstrează la actualizări și permite redeschiderea fără internet. Ștergerea stocării sau reinstalarea poate necesita o nouă activare. Confirmarea are valabilitate de zece ani, la fel ca mecanismul de referință; nu implică reconectări frecvente.

Activarea este separată de contul aplicației Firebase și de Google Drive. Nu înlocuiește drepturile Firebase și nu cere parola Google. Confirmarea activării nu intră în backupurile sau sincronizarea agendei.

## Instalare și actualizare

Android 5.0.15 are un identificator și o semnătură noi. Se instalează separat de ediția Android anterioară. Pentru transferul unei agende, exportă întâi o copie de siguranță în ediția veche și import-o în cea nouă.

Pe iPhone, folosește pictograma deja instalată și alege Setări → Verifică actualizările → Actualizează aplicația. Poți salva întâi o copie din Setări → Date și backup.

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

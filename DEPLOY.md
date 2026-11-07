# Activare și instalare — Android și iPhone 5.0.9

## Ce este pregătit

La **3 noiembrie 2026**, proiectul aplicatia-frizerie este adăugat în Firebase pe **Spark**, autentificarea **Email/Password** este activată și baza **Cloud Firestore Standard** este creată în **europe-west3**. Configurația publică este inclusă în APK și în aplicația web. Nu s-au activat facturarea, Blaze sau trialuri.

**Regulile Firestore sunt publicate în proiectul real, cu aprobarea proprietarului.** Regulile sunt pregătite în [firebase/firestore.rules](firebase/firestore.rules) și au trecut cele 17 teste locale din emulator. Excluderea conținutului fragmentelor de la indexare este aplicată și verificată în consola reală; configurația este în [firebase/firestore.indexes.json](firebase/firestore.indexes.json).

APK-ul nou și versiunea web sunt pregătite pentru testarea pe telefoane. Testele locale și emulatorul nu confirmă încă autentificarea reală, verificarea emailului sau transferul între telefoane fizice.

## 1. Finalizarea Firebase

Regulile pregătite sunt publicate și verificate în Firestore → Rules, după aprobarea proprietarului. Acestea permit acces numai utilizatorului Firebase cu email verificat și aprobat, având UID egal cu cel din calea datelor. Aprobările sunt administrate în colecția separată salonAccess, inaccesibilă din aplicație. Contul existent macsocietysrl@gmail.com rămâne aprobat. Nu înlocui regulile cu acces public de test.

Indexurile pentru conținutul fragmentelor sunt deja configurate. Nu sunt necesare Storage, Functions, TTL, PITR sau backupuri administrate Firestore. Detaliile tehnice și comanda de publicare limitată la reguli/indexuri sunt în [ghidul Firebase](firebase/README.md). Acest pas nu necesită plan cu plată.

## 2. Actualizarea aplicației

**Android:** exportă agenda curentă, apoi instalează **Agenda-Frizerie-5.0.9.apk** peste cea existentă, fără dezinstalare. Deschide aplicația și verifică datele locale înainte de conectarea la cloud. Logica, tema și baza locală sunt păstrate; Firebase înlocuiește sincronizarea Drive ca flux principal.

**iPhone:** pentru instalarea existentă, deschide **Setări → Verifică actualizările** și acceptă actualizarea la **5.0.9**, după închiderea formularelor nesalvate. Păstrează aplicația și datele sale. Pentru o instalare nouă, deschide aceeași adresă HTTPS în Safari și adaug-o pe ecranul principal. Așteaptă pregătirea pentru offline înainte să testezi fără internet.

[Adresa instalării stabilite](https://caiuspoputa-debug.github.io/tool-upload-iphone/) trebuie verificată în momentul instalării. Faptul că sursele sunt pe GitHub nu confirmă că noua versiune este deja publicată.

## 3. Contul aplicației

În **Setări → Sincronizare și backup Firebase**:

1. Introdu o **parolă nouă, separată, pentru aplicație** și apasă „Creează contul aplicației”. Introdu adresa aprobată a salonului în câmpul editabil. Contul existent poate continua să folosească macsocietysrl@gmail.com.
2. Deschide mesajul de verificare trimis la această adresă și confirmă emailul.
3. Revino în aplicație și apasă „Am verificat adresa de e-mail”.

Dacă acel cont Firebase există deja, apasă „Conectează contul aplicației” cu parola aplicației. Dacă ai uitat-o, folosește resetarea parolei din aplicație.

**Nu introduce aici parola contului Google.** Contul Firebase și parola sa sunt ale aplicației; nu se adaugă contul Google în setările Android. Conectarea este păstrată local de Firebase și se reînnoiește automat în condiții normale. Deconectarea explicită, schimbarea parolei sau ștergerea datelor aplicației pot cere o nouă conectare.

## 4. Alegerea agendei inițiale

Pe dispozitivul care conține **agenda completă**, apasă „Conectează agenda Firebase”. Dacă nu există agendă în cloud, aplicația cere confirmarea creării ei din datele acestui dispozitiv.

În edițiile 1.1.4/5.0.4, reluarea propriei creări întrerupte păstrează și modificările locale făcute între timp. O agendă deja creată de o ediție veche, fără o confirmare locală identificabilă, cere în continuare aprobare explicită pentru preluare; mesajul arată separat numărul clienților și programărilor locale și din cloud. Preluarea înlocuiește agenda activă și păstrează o copie locală exportabilă dinaintea schimbării. Păstrează un export actual înainte de confirmare.

Pe celălalt telefon folosește **același cont al aplicației**. Aplicația cere confirmarea preluării agendei comune și păstrează o copie locală exportabilă a datelor de dinaintea Firebase. Nu începe cu o agendă goală dacă datele complete sunt pe alt telefon.

Poți folosi numai iPhone-ul: acesta poate crea agenda comună și face backup singur, fără un Android intermediar.

Păstrează ambele aplicații deschise și online pentru primul test. Modifică un preț de serviciu de test, verifică preluarea pe al doilea telefon, apoi testează o modificare offline și revenirea online. Verifică separat istoricul, o programare și un eventual conflict; programările finalizate și prețurile manuale își păstrează regulile existente.

## 5. Backup și restaurare

Backupul automat Firebase rulează aproximativ la un minut după modificări, cu aplicația deschisă, conectată și după sincronizare reușită. În Setări există comutatorul, „Fă backup Firebase acum”, istoricul și restaurarea cu confirmare.

Se păstrează ultima copie din fiecare dintre ultimele **șapte zile în care s-a făcut backup**. Curățarea este făcută de aplicație după confirmarea unei copii noi; nu este un serviciu programat pe server. Cu aplicația închisă nu există backup garantat. Dacă datele nu s-au schimbat, nu se creează inutil o nouă copie.

Restaurarea înlocuiește agenda locală și transmite înlocuirea și către dispozitivele sincronizate după confirmare. Înaintea confirmării se salvează o copie locală exportabilă a agendei curente. Pentru verificare folosește întâi date de test și un export local păstrat separat.

Backupul în **Google Drive** este opțional și independent. Îl conectezi separat dacă îl dorești; propriile reconectări sau limite Google Drive nu condiționează sincronizarea Firebase.

Aplicația afișează „Reconectează Google Drive” când autorizarea necesită din nou intervenția utilizatorului, inclusiv în afara Setărilor. Apasă butonul din mesaj pentru a deschide conectarea Google sau „Mai târziu” pentru a amâna. Reînnoirea automată reușită pe Android nu cere această intervenție. Mesajul nu modifică agenda și nu cere parola Firebase.

## 6. Date vechi și publicarea paginii

Datele de lucru rămân în stocarea locală existentă. Configurația vechii sincronizări Drive este păstrată în metadatele de migrare; copia de dinaintea Firebase se poate exporta din Setări. Pentru ediția istorică cu server și bază separată pe cont, folosește exportul din ediția veche și importul în cea nouă.

Publicarea temporară pe GitHub Pages distribuie fișierele aplicației. Accesul la agenda cloud este verificat separat de regulile Firebase. Trecerea ulterioară a depozitului în privat nu revocă instalările deja făcute și nu șterge datele lor locale. O copie pregătită offline poate continua să funcționeze, dar după retragerea adresei reconectarea și actualizările nu sunt garantate pe iPhone; republică aceeași adresă dacă este necesară reîncărcarea.

## Verificări rămase

- Regulile și indexurile sunt publicate și verificate; nu mai lipsește un pas de activare a bazei.
- Crearea/conectarea contului real al aplicației și confirmarea emailului.
- Android și iPhone reale: sincronizare în ambele sensuri, revenire după offline, repornire, backup și restaurare.
- Funcționarea iPhone-ului după instalarea offline și după eventuala retragere a paginii.

## Actualizările Android începând cu 5.0.5

Instalează manual 5.0.5 peste ediția anterioară, fără dezinstalare. Începând cu această ediție, prima deschidere din fiecare zi verifică discret metadatele ultimei versiuni publicate. Dacă există una nouă, apare același popup ca în Salon: „Instalează” sau „Mai târziu”. Amânarea ține până a doua zi, iar verificarea manuală rămâne disponibilă în Setări. Offline sau la o eroare de rețea nu apare un popup de eroare; verificarea se reia când aplicația revine online.

Descărcarea începe doar la apăsarea „Instalează”. Android poate cere permisiunea pentru instalări din această sursă; după acordare revii în aplicație și apeși din nou. Fișierul este verificat înainte de a deschide confirmarea de instalare Android. Agenda, conturile și backupurile nu sunt modificate de verificare. Pe iPhone continuă să fie folosit mecanismul existent de actualizare din Setări.

## Aprobarea unui alt salon — versiunea 5.0.6

În consola administrativă Firestore → Data, adaugă un document în colecția `salonAccess`. ID-ul documentului este adresa exactă a salonului, cu litere mici; câmpul `enabled` este de tip **boolean**, cu valoarea **true**. Aprobarea nu poate fi creată sau modificată din aplicație. Pentru revocare, administratorul poate seta `enabled` la **false**.

În aplicația Frizerie, persoana introduce adresa aprobată și creează contul cu o parolă separată de parola Google, apoi confirmă adresa prin mesajul Firebase. Mai multe dispozitive ale aceluiași salon folosesc același cont. Un alt cont primește propria cale de date `accounts/<uid>/workspaces/main`; nu preia agenda contului existent.

Dacă instalarea locală este deja legată de alt UID sau are o conectare inițială întreruptă pentru alt UID, sincronizarea, backupul și restaurarea sunt blocate pentru acel cont diferit. Datele locale rămân disponibile; reconectează contul original. O instalare nouă pentru alt salon pornește cu propria agendă. Nu există transfer automat între saloane.

Această modificare privește Firebase. Din 5.0.9 opțiunea separată de backup Google Drive acceptă contul ales de utilizator; autorizarea existentă și preferințele contului inițial sunt păstrate. Planul rămâne Spark, fără activarea facturării sau a unui trial.

## Rezultatul verificării manuale Android — 5.0.7

„Verifică acum” afișează o notificare vizibilă când aplicația este la zi sau verificarea nu poate fi finalizată. Versiunile noi păstrează popupul cu „Instalează” / „Mai târziu”. Verificările automate nu afișează notificări când versiunea este curentă sau apare o eroare.

## Starea unei programări noi — 5.0.8

O programare nouă poate fi doar „În așteptare” sau „Confirmată”. După salvare, starea se poate schimba prin fluxurile existente. Programările deja anulate, finalizate sau cu neprezentare și istoricul lor se păstrează la actualizare, import și sincronizare.

## Google Drive Production — 5.0.9

Google Auth Platform → Audience este **In production**, User type **External**. Paginile publice de prezentare și confidențialitate sunt configurate. Nu au fost activate facturarea, carduri sau trialuri. Permisiunile cerute în cod rămân `drive.file openid email`; nu se cere acces la întregul Drive.

Actualizează aplicația înainte de noua conectare, pentru a elimina și restricția veche de email. Închide fereastra Google care arată vechea eroare 403, apoi pornește din nou „Conectează Google Drive” și alege contul dorit. Autorizează numai pe pagina Google. Schimbarea Production elimină lista de testeri; verificarea identității Google și limitele normale ale serviciilor rămân.

Pe Android, autorizarea deja criptată a contului MAC este compatibilă cu noua ediție. Nu o revocăm automat. Metadatele backupului sunt păstrate separat sub cheia locală `agenda.drive.direct.v2.<Google-SUB>`. Preferințele vechi se copiază o singură dată numai pentru contul MAC autentificat, fără ștergerea cheii vechi. Alt cont nu preia MD5-ul, hashul sau timpul backupului contului anterior. Rezultatele întârziate sunt ignorate la schimbarea identității. Un backup existent diferit în contul nou cere confirmare înainte de înlocuire.

Pe iPhone, autorizarea Drive folosește în continuare tokenuri de acces scurte; Production nu transformă acest flux într-o sesiune offline permanentă. Firebase rămâne sincronizarea principală, cu propria aprobare a adresei și sesiune persistentă. Vechiul backend de sincronizare Drive rămâne restricționat la contul său inițial, fără schimbarea protocolului sau a datelor sale.

Politica de confidențialitate este disponibilă din Setări și la https://caiuspoputa-debug.github.io/tool-upload-iphone/privacy.html. Google Play Protect pentru APK este o verificare separată: Production OAuth nu este o confirmare Google că APK-ul a trecut evaluarea Play Protect.


## Verificarea actualizărilor Android — 5.0.10

Metadatele Android sunt citite direct de la `https://caiuspoputa-debug.github.io/tool-upload-iphone/android-update.json`, fără redirecționarea fișierului JSON prin GitHub Releases. APK-ul rămâne în același depozit GitHub și este verificat prin dimensiune, SHA-256, pachet, versiune și certificatul instalării existente.

Verificarea nativă are un termen independent de 15 secunde. Protecția JavaScript eliberează interfața după 20 de secunde dacă răspunsul nativ lipsește. O verificare automată poate fi preluată manual prin apăsare, fără a crea altă cerere sau a reseta termenul. Rezultatele manuale primite în fundal sunt afișate la revenire. Verificările automate rămân discrete.

Pentru trecerea de la 5.0.9, dacă verificarea veche se blochează, descarcă APK-ul nou din pagina comună și instalează-l peste aplicație, fără dezinstalare. Numărul versiunii este 5.0.10 pe ambele platforme. iPhone își păstrează actualizarea prin service worker; sincronizarea, conturile și agenda nu sunt modificate de mecanismul de verificare Android.


## Recuperarea rezultatului Android — 5.0.11

Rezultatul public al fiecărei cereri este păstrat într-un registru local în memorie, limitat la opt cereri, înainte de notificarea WebView. Interfața citește registrul după identificator, fără a repeta cererea de rețea; răspunsurile întârziate sau duplicate sunt ignorate. Citirea nu accesează WebView, conturi, agenda sau disc; acțiunile de verificare și instalare păstrează controlul strict al paginii locale.

Termenul de verificare rămâne 15 secunde în Android și 20 de secunde ca protecție a interfeței. Un rezultat deja primit este procesat înainte de expirarea termenului la revenire. Închiderea fluxului și a conexiunii de metadate se face separat, astfel încât un răspuns valid să nu fie ținut ocupat de închiderea conexiunii. Erorile au motive și coduri fixe, fără adrese, conturi sau mesaje de excepție brute.

Există verificări Java, browser și un test izolat în Android 6/API23 pentru mecanismul JavaBridge/WebView, cu notificări eliminate intenționat. Testul izolat folosește o adaptare doar în copia de probă pentru API23 și un handler ES5; nu reprezintă testarea APK-ului complet pe telefonul utilizatorului. Aplicația de producție păstrează minimum Android 8/API26, semnătura și verificările APK.


## Finalizarea migrării originii Android — 5.0.12

WebView nu trimite către `shouldInterceptRequest()` cererile speciale `file:///android_asset/`. Pe tableta afectată, aplicația completă rămânea astfel pe documentul legacy cu migrarea restantă, iar controlul strict HTTPS respingea cererile actualizatorului.

Fallbackul din `onPageFinished()` rulează scriptul existent de migrare numai când instanța WebView, URL-ul callbackului, documentul curent și starea migrării corespund exact documentului legacy. Preferințele permise sunt filtrate și confirmate nativ înaintea navigării la HOME HTTPS. `trustedPage()` rămâne strict; nu sunt autorizate pagini file sau externe pentru acțiunile aplicației.

SQLite și contul nativ Google Drive folosesc în continuare aceeași instalare. Nu se șterg datele aplicației. În cazul unei sesiuni Firebase păstrate exclusiv de browser pe originea veche poate fi necesară conectarea normală pe noua origine; tokenurile/parolele nu sunt copiate prin migrarea preferințelor.

Cauza a fost confirmată prin USB pe SM-T220 / Android 14 / WebView 156, cu APK 5.0.10 identic celui publicat. După corecție, pagina a fost recunoscută ca sigură, migrarea a fost finalizată și butonul a afișat rezultatul versiunii curente.

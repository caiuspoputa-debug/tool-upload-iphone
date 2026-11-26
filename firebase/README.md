# Firebase Spark pentru Agenda Frizerie

Acest director conține regulile Firestore, indexurile și testele locale. Nu creează un proiect, nu activează facturarea și nu publică automat reguli în proiectul real.

## Stare reală la 3 noiembrie 2026

Proiectul aplicatia-frizerie este adăugat în Firebase pe Spark, Email/Password este activat și baza Firestore Standard este creată în europe-west3. Configurația publică este inclusă în APK 1.1.0 și PWA 5.0.0. Excluderea chunks.payload de la indexare este salvată și verificată în consola reală: Ascending, Descending și Arrays sunt dezactivate pentru colecție; indexurile grupului de colecții sunt dezactivate implicit. **Regulile sunt publicate și verificate în proiectul real, după aprobarea proprietarului.** Testele fizice de conectare și sincronizare nu sunt efectuate. Nu s-au activat facturarea sau trialuri.

## Configurare și finalizare

1. Deschide proiectul Google Cloud/Firebase al aplicației în contul care îl administrează. Păstrează planul **Spark**, fără cont de facturare, trial sau upgrade Blaze.
2. În Firebase Authentication activează **Email/Password**. Persoana creează contul Firebase cu adresa aprobată a salonului și o parolă pentru aplicație; parola nu trebuie să fie parola contului Google. Adresa trebuie confirmată prin mesajul de verificare Firebase.
3. Creează baza **Cloud Firestore Standard**, în modul Production, alegând regiunea potrivită înainte de creare. Nu activa Storage, Functions, TTL, PITR sau backupurile administrate de Firestore pentru acest protocol.
4. Regulile din [firestore.rules](firestore.rules) sunt publicate în proiectul curent. Pentru un proiect nou, publică același text în fila Firestore → Rules. Regulile deschise de test nu sunt potrivite pentru această aplicație.
5. Excluderea din [firestore.indexes.json](firestore.indexes.json) este deja aplicată în proiectul curent. Pentru un proiect nou, aplică aceeași configurație, care exclude conținutul fragmentelor de la indexare. Din acest director, un administrator autentificat în Firebase CLI poate publica numai aceste două resurse:

   ```powershell
   npx firebase deploy --only firestore:rules,firestore:indexes --project aplicatia-frizerie
   ```

6. Completează configurația publică Firebase a aplicației și testează pe telefoane autentificarea, confirmarea adresei, sincronizarea și restaurarea. Confirmarea emailului cere reîncărcarea utilizatorului și reînnoirea tokenului Firebase pentru ca regulile să primească noua valoare `email_verified`.

Proiectul și serviciile de mai sus au fost configurate în consolă. Regulile și indexurile sunt publicate și verificate. Crearea/verificarea contului real al aplicației și testele pe telefoane rămân pași separați de testele locale ale regulilor.

## Acces și protocol

Fiecare citire sau scriere cere simultan un utilizator autentificat, UID egal cu UID-ul din cale, email verificat (`email_verified == true`) și un document administrativ `salonAccess/<email-cu-litere-mici>` cu `enabled == true`. Regulile nu limitează furnizorul tokenului; în ediția actuală se activează numai Email/Password. Telefoanele aceluiași salon folosesc același cont Firebase și același UID; alte saloane au UID-uri și agende separate. Clienții nu pot citi, lista sau modifica documentele de aprobare `salonAccess`.

Toate documentele aplicației sunt sub `/accounts/{uid}/workspaces/main`:

| Cale relativă | Conținut și comportament |
| --- | --- |
| documentul rădăcină | `version`, `protocol`, `workspace`, `genesisRevision`, `createdAt`; conținut imuabil, ștergerea din client interzisă |
| `payloads/{revision}` | `version`, `sha256`, `bytes`, `chunkCount`, `createdAt`; manifest imuabil |
| `payloads/{revision}/chunks/{index}` | `version`, `index`, `payload`; fragment imuabil, ID precum `0000` |
| `journals/{device}` | `version`, `workspace`, `device`, `revision`, `sha256`, `bytes`, `chunkCount`, `updatedAt`; capul jurnalului dispozitivului |
| `backups/{YYYY-MM-DD}` | `version`, `workspace`, `revision`, `sha256`, `bytes`, `chunkCount`, `createdAt`, `sourceDevice`; instantaneul unei zile |
| `backupState/current` | `version`, `workspace`, `day`, `revision`, `updatedAt`; indicatorul ultimului backup confirmat |

`revision` este o generație nouă aleatoare de 64 caractere hexazecimale mici. Nu este checksumul conținutului; `sha256` este checksumul separat. ID-urile de workspace și dispozitiv acceptă 1–128 caractere ASCII alfanumerice, `_` sau `-`. Timestampurile sunt întregi nenegative, în milisecunde, în limita numerelor întregi sigure JavaScript.

Un manifest permite cel mult 30 MiB de conținut original și 1–256 fragmente. Un fragment are index întreg 0–255 și conținut base64 standard ASCII, nevid, cu cel mult 200 KiB UTF-8. Actualizările documentelor imuabile sunt permise numai dacă datele sunt identice, pentru repetarea sigură a unui upload. Proprietarul poate șterge fragmente, manifeste și capete pentru curățarea făcută explicit de aplicație.

Regulile verifică accesul, câmpurile și limitele. Clientul verifică digestul, reconstrucția fragmentelor, indexul față de ID-ul său, coerența workspace-ului și schimbarea atomică a capetelor prin tranzacții. Numai după confirmarea noii generații poate curăța generația anterioară indicată de propriul cap. Formatul datei verifică luna și ziua 1–31; calendarul complet se validează în aplicație.

Backupurile sunt instantanee scrise de aplicație în Firestore. Nu folosesc produsul de backup administrat Firestore. Depășirea cotelor Spark trebuie tratată de aplicație ca o eroare temporară, păstrând modificările locale; nu se activează automat facturarea.

## Verificare locală

Testat cu Node 24 și Java 21. Din acest director:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"
$env:JAVA_TOOL_OPTIONS='-Xms32m -Xmx512m -XX:+UseSerialGC'
npm test
```

Comanda pornește numai emulatorul local Firestore, folosind proiectul fictiv `demo-agenda-frizerie`. Testele refuză să ruleze fără adresa emulatorului local. Prima pornire descarcă emulatorul oficial; nu cere proiect real sau autentificare Google.

**Rezultat local la 3 noiembrie 2026: 17/17 teste trecute.** Sunt verificate accesul neautentificat, UID/email greșite, email neconfirmat, câmpuri/tipuri invalide, limitele fragmentelor și manifestelor, imutabilitatea, căile nepermise, interogările între conturi și respingerea atomică a unui batch nepermis. Aceste teste nu confirmă încă autentificarea reală sau sincronizarea pe telefoane.

Documentație oficială: [testarea regulilor cu emulatorul](https://firebase.google.com/docs/firestore/security/test-rules-emulator), [identitatea și emailul verificat](https://firebase.google.com/docs/rules/rules-and-auth), [dimensiunea UTF-8 în reguli](https://firebase.google.com/docs/reference/rules/rules.String), [indexuri pentru câmpuri mari](https://firebase.google.com/docs/firestore/best-practices), [cote Firestore](https://firebase.google.com/docs/firestore/quotas).

## Aprobare și migrare fără schimbarea agendei

Înaintea activării regulilor cu lista de aprobări, administratorul creează documentul `salonAccess/macsocietysrl@gmail.com` cu `enabled: true` boolean pentru a păstra accesul existent. După aceea poate publica regulile verificate. Agendele, UID-urile, jurnalele și backupurile existente nu se mută și nu se șterg.

Pentru fiecare alt salon, adaugă o singură aprobare în aceeași colecție, cu emailul în litere mici drept ID. Numai consola/SDK-ul administrativ cu drepturi IAM poate modifica aprobările. Parola și verificarea emailului se gestionează prin Firebase Authentication.

# IT-Ticket — intern IT-support

IT-Ticket samlar intern IT-support i ärenden, med kontakter, handläggning och kommunikation. Ordlistan definierar verksamhetens begrepp.

## Language

### Ärenden och personer

**Ärende**:
En registrerad begäran om IT-hjälp eller en IT-relaterad åtgärd, med en beskrivning och ett aktuellt handläggningsläge.
_Avoid_: Ticket i svensk verksamhetstext, uppgift som synonym för hela ärendet.

**Kontakt**:
En person i kontaktregistret som kan vara beställare för ett ärende. Att vara kontakt innebär inte att personen har inloggning till IT-Ticket.
_Avoid_: Användare när endast en kontakt avses.

**Beställare**:
Den kontakt som är registrerad som den som begär hjälp i ett visst ärende. Beställaren kan vara en annan person än den som registrerar eller handlägger ärendet.
_Avoid_: Kund, rapportör och användare som alternativa namn på denna ärenderoll.

**Användare**:
En person med ett konto för att logga in och arbeta i IT-Ticket. Användarkontot och en kontakt för samma person är skilda begrepp.
_Avoid_: Kontakt som synonym för inloggat konto.

**Handläggare**:
Den användare som ett ärende är tilldelat för handläggning. Ett ärende kan sakna handläggare.
_Avoid_: Beställare, skapare eller administratör som synonym för tilldelad handläggare.

**Skapare**:
Den användare som registrerade ärendet när det skapades genom ett inloggat arbetsflöde. Ett ärende som kommer in via e-post behöver inte ha en sådan skapare.
_Avoid_: Beställare eller handläggare när registrerande användare avses.

**Företag**:
En organisation som en kontakt eller ett ärende hör till. Företagstillhörighet innebär inte att organisationen har en egen separat IT-Ticket-instans.
_Avoid_: Tenant som synonym för företagstillhörighet.

### Handläggning och indelning

**Ärendestatus**:
Ärendets aktuella handläggningsläge: Öppen, Pågående, Väntar, Löst eller Stängd.
_Avoid_: Prioritet som synonym för status.

**Aktivt ärende**:
Ett ärende med status Öppen, Pågående eller Väntar.
_Avoid_: Öppet ärende som samlingsnamn för samtliga aktiva statusar.

**Avslutat ärende**:
Ett ärende med status Löst eller Stängd. Avslutade ärenden omfattar därmed fler ärenden än enbart stängda ärenden.
_Avoid_: Stängt ärende som synonym för hela gruppen avslutade ärenden.

**Öppet ärende**:
Ett ärende med den specifika statusen Öppen.
_Avoid_: Ej stängt när den specifika statusen Öppen avses.

**Löst ärende**:
Ett ärende vars behov eller problem bedöms vara åtgärdat och som har status Löst.
_Avoid_: Stängt ärende som synonym för att behovet har åtgärdats.

**Stängt ärende**:
Ett ärende vars handläggning är avslutad och som har status Stängd. Det kan stängas utan att först vara löst, exempelvis när beställaren återkallar sin begäran.
_Avoid_: Löst ärende som synonym för alla stängda ärenden.

**Otilldelat ärende**:
Ett ärende som saknar handläggare. Tilldelning och ärendestatus beskriver olika saker.
_Avoid_: Öppet ärende som synonym för otilldelat.

**Prioritet**:
Ärendets angelägenhetsnivå: Låg, Medium, Hög eller Kritisk.
_Avoid_: Status eller SLA som synonym för prioritet.

**Ärendekategori**:
Den valfria indelning som beskriver vilken typ av IT-hjälp eller åtgärd ärendet gäller. Ett ärende hör till högst en ärendekategori.
_Avoid_: Ärendetagg eller kunskapsbaskategori som synonym.

**Ärendemall**:
En återanvändbar förlaga för en viss typ av ärende, med förifyllt innehåll eller särskilda uppgifter att fylla i.
_Avoid_: Återkommande ärende som synonym för mall.

### Kommunikation och dokumentation

**Ärendekommentar**:
Ett meddelande eller en anteckning i ett ärendes kommentarstråd. Kommentaren kan vara intern eller ingå i kommunikationen med beställaren.
_Avoid_: Lösning som synonym för varje kommentar.

**Intern kommentar**:
En ärendekommentar avsedd för det interna arbetet, inte för utskick till beställaren.
_Avoid_: Publikt svar.

**Publikt svar**:
En ärendekommentar avsedd som svar till beställaren via e-post. Benämningen innebär varken att svaret är synligt för alla eller att ett e-postutskick har levererats.
_Avoid_: Delningslänk, offentlig publicering eller levererat mejl som synonym.

**Inkommande e-postsvar**:
Ett mottaget e-postmeddelande som hör till ett befintligt ärende och ingår i dess kommentarstråd.
_Avoid_: Nytt ärende som synonym för varje inkommande mejl.

**Intern ärendeanteckning**:
Samlad intern information om ärendet, skild från enskilda kommentarer i kommentarstråden.
_Avoid_: Intern kommentar när ärendets sammanhållna anteckning avses.

**Lösning**:
Ärendets dokumenterade beskrivning av hur behovet eller problemet har hanterats. Lösningstext och ärendestatus är skilda begrepp.
_Avoid_: Löst som synonym för själva lösningstexten.

**Ärendehistorik**:
Spåret över registrerade förändringar i ett ärende, exempelvis byte av status, prioritet eller handläggare.
_Avoid_: Kommentarstråd som synonym för ändringshistorik.

**Delningslänk för ärende**:
En länk som ger mottagaren tillgång till en begränsad läsvy av ett ärende utan inloggning. Kommentarstråden och interna ärendeanteckningar ingår inte i läsvyn.
_Avoid_: Publikt svar som synonym för delning av ärendet.

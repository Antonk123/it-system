# 0004 — Separat användarportal för Navet

Status: utvecklingskandidat 2026-11-16, godkänd mockup, endast lokal verifiering.

ADR 0001 gäller fortsatt IT-personal. Vanliga Navet-användare får inga
personalkonton eller personal-JWT. Nytt `/support` och `/api/self-service`
kräver kortlivad, separat signerad Navet-identitet. Befintlig profilbrygga
är fortsatt enbart visningsdata och får aldrig autentisera.

Ägarskap lagras som (issuer, subject) vid skapandet i samma transaktion som
ärendet. E-post är kontaktuppgift, aldrig åtkomstbevis eller automatisk migrering.
Alla läsningar, svar och nedladdningar kontrollerar ägarskap på servern.
Interna kommentarer och omarkerade personalbilagor delas inte med användaren.
Personalens publika kommentarstext återanvänds. Statusen waiting benämns Väntar;
den bevisar inte att det är just användarens svar som saknas.

Migration 094 tillför bara sidotabeller; inga befintliga ärenden eller konton
ändras. Inställningar är opt-in, separata per miljö. Inga produktionsnycklar,
mejl eller verksamhetsdata får användas lokalt. Produktionsaktivering kräver
ett separat leveransbeslut. Lokal testning valdes av Anton; ingen serverstack
ska återinföras i detta uppdrag.

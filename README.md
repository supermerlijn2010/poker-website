# Friendly Poker Night

Een lichte pokerwebsite om gratis met vrienden te spelen. Gebruik een gedeelde tafelcode, voeg spelers toe en laat de host de rondes starten. Geen echt geld; iedereen krijgt automatisch speelchips.

## Starten

1. Installeer Node.js 18+.
2. Start de server:

```bash
node server.js
```

3. Open [http://localhost:3000](http://localhost:3000) en vul een naam en tafelcode in. Deel dezelfde code met je vrienden zodat jullie samen aan tafel zitten.

## Spelverloop

- De eerste speler is host en kan een ronde starten (minimaal twee spelers vereist).
- De server gebruikt blinds van 5/10 speelchips en deelt twee kaarten per speler uit.
- Acties worden om beurten gedaan: fold, check/call, bet/raise.
- Na de river ga je naar showdown; kies de winnaar om de pot uit te keren en start daarna een nieuwe ronde.

Alle spel- en tafelinformatie blijft in het geheugen van de server. Stop je het proces, dan reset de tafel automatisch.

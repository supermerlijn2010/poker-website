# Friendly Poker Night

Een lichte pokerwebsite om gratis met vrienden te spelen. Gebruik een gedeelde tafelcode, voeg spelers toe en laat de host de rondes starten. Geen echt geld; iedereen krijgt automatisch speelchips.

## Starten

1. Installeer Node.js 18+.
2. Start de server:

```bash
node server.js
```

3. Open [http://localhost:3000](http://localhost:3000) of gebruik het IP-adres van je machine (bijv. `http://192.168.0.10:3000`) zodat vrienden op hetzelfde netwerk kunnen verbinden. Vul een naam en tafelcode in en deel dezelfde code met je vrienden zodat jullie samen aan tafel zitten. Tafelcodes worden automatisch naar kleine letters opgeschoond zodat hoofdletters/spaties geen dubbele kamers maken.

## Spelverloop

- De eerste speler is host en kan een ronde starten (minimaal twee spelers vereist).
- De server gebruikt blinds van 5/10 speelchips en deelt twee kaarten per speler uit.
- Acties worden om beurten gedaan: fold, check/call, bet/raise.
- Na de river wordt showdown automatisch beoordeeld; de winnende hand ontvangt de pot (verdeeld bij gelijke handen) en wordt in de UI gemarkeerd.
- Alle kaarten worden zichtbaar bij showdown en de interface toont echte speelkaart-afbeeldingen.

Alle spel- en tafelinformatie blijft in het geheugen van de server. Stop je het proces, dan reset de tafel automatisch.

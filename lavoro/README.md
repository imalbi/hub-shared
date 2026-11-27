# Lavoro

## Mail delle candidature

I collegamenti conservano solo la chiave della candidatura, l'account, il Message-ID e la data del collegamento. Il testo resta in Posta e viene letto dal browser in testo semplice senza segnare il messaggio come letto. Rimuovere una candidatura rimuove anche i suoi collegamenti.

Con Posta attiva, il pannello propone messaggi in arrivo e inviati cercando separatamente il nome dell'azienda nel mittente e nell'oggetto, dalla data della candidatura meno tre giorni. Il collegamento richiede sempre una scelta esplicita. La ricerca libera non ha il limite iniziale di data.

Candidature separa In attesa (senza colloqui), In colloquio e Chiuse. Dopo più di 21 giorni dall'ultimo colloquio, una candidatura ancora in attesa o in colloquio è mostrata come scaduta senza cambiare lo stato salvato; un colloquio futuro rinvia la scadenza. Senza colloqui la stessa soglia parte dalla candidatura. Statistiche conta come risposta colloqui, offerte e rifiuti, non le mail collegate; Ghosting include tutte le scadute e indica quante hanno un colloquio salvato.

Le conversazioni non includono il mittente: il pannello lo cerca nelle pagine della casella corrispondente. Questa ricerca può richiedere più richieste e mostra il mittente come non disponibile se non riesce. Il client privato usa una cache React Query separata e il percorso di `query-core` creato da pnpm; se cambia il layout delle dipendenze serve una via condivisa dal workspace web.

## Posta letta dal modello locale (passo 51)

`mailCheck` nel profilo Lavoro (senza account resta spento): gli account himalaya da leggere, il modello Ollama (`gemma4:12b-it-qat`), i giorni da leggere, quante mail per controllo, i giorni di Da fare e il controllo automatico ogni mezz'ora. Solo Ollama, mai Gemini: il testo delle mail non lascia il PC, anche se il Parere usa Gemini.

Il controllo (`mail-check.ts`, tasto Controlla posta in Candidature) legge le mail ricevute che nessun controllo precedente ha letto, dalla più recente, fino a `maxPerRun`. Gli id letti restano in `mail_checked`, così un riavvio o un secondo controllo non rilegge nulla (il passo 39 farà il polling senza pagina). Ogni chiamata passa da `llmGate` senza contare nel limite giornaliero del Parere. Un errore del provider ferma il controllo e lascia le mail da leggere; una risposta che non si interpreta viene salvata come `invalid` e non si ripete. I log hanno solo codici, mai oggetto, indirizzo o testo.

Ogni candidatura conserva indirizzi minuscoli, ricavati dal testo dell'annuncio, dalle conversazioni collegate o aggiunti nel dettaglio. Le mail inviate che citano azienda o titolo propongono indirizzi da confermare. Un mittente esatto appartenente a una sola candidatura aperta collega subito la mail, anche se il modello non riconosce l'azienda. Altrimenti un collegamento automatico richiede che il modello dica `alta`, che il nome dell'azienda o il dominio aziendale compaia nella mail e che nessun'altra candidatura possieda già la conversazione; i domini dei provider comuni non sono prova. `media`, o `alta` senza il nome, diventa un suggerimento; `bassa` si scarta. Rifiuto e invito diventano proposte (`mail_proposals`: collegamento, stato, colloquio) che il proprietario conferma con un tocco; nessuno stato cambia da solo. Il colloquio proposto ha data e ora della mail (09:00 se manca l'ora) e come etichetta il luogo o il link. Confermare un suggerimento di collegamento fa nascere anche le proposte che la mail portava.

Da fare in Oggi legge le risposte salvate: le mail degli ultimi `todoDays` giorni con una richiesta, la scadenza più vicina per prima, al massimo cinque; Nascondi le toglie. Limite noto: una richiesta resta finché non viene nascosta, anche dopo una risposta.

## Preparazione e lacune

Il dettaglio della candidatura mostra l'ultimo file `colloquio-YYYY-MM-DD[-N].md` nella cartella della candidatura; Statistiche mostra l'ultimo `lacune-YYYY-MM-DD[-N].md`. La cartella di partenza è quella già impostata in `skills/paths.local.json`. Il file viene riletto all'apertura; Apri il file apre l'ultima preparazione sul PC. Non vengono modificati i file.

Il formato riconosce titoli fino al terzo livello, paragrafi, elenchi semplici, grassetto, codice, link HTTP(S), separatori e righe `<sub>Fonte: ...</sub>`. Altri elementi restano testo. I percorsi risolti fuori da `candidature/` non vengono letti.

## Fonti a elenco

`search.sites` e `search.queries[].sites` accettano anche `rss`, `altamira` e `smat`. Abilitare una fonte richiede il relativo blocco in `search`; nessun datore o luogo viene aggiunto automaticamente.

```json
{
  "rss": { "feeds": [{ "url": "https://feeds.example.org/jobs", "company": "Example" }], "maxItems": 500 },
  "altamira": {
    "employers": [{ "listUrl": "https://board.example.org/Example", "company": "Example" }],
    "maxPages": 10
  },
  "smat": { "baseUrl": "https://water.example.org/jobs", "company": "Example" }
}
```

RSS legge RSS 2.0 e Atom senza richieste ai dettagli. Altamira legge le liste HTML e i dettagli dei soli annunci nuovi; supporta la paginazione tramite link pubblici, segnala come incompleta quella tramite postback. SMAT esclude gli avvisi marcati come chiusi: conserva il testo della riga e il link pubblico del bando, sempre con dettagli incompleti finché i requisiti nel PDF non sono letti. Una riga con più profili rimane un bando unico. La sede resta sconosciuta se non è dichiarata dalla fonte.

Per un datore SuccessFactors con API unificata, aggiungere `"mode": "unified", "locale": "it_IT"` alla sua voce in `search.successfactors.employers`. La modalità HTML rimane quella predefinita. L'API usa pagine da zero, conserva tutte le sedi dichiarate e non trasforma date ambigue in date di pubblicazione. Il titolo provvisorio `Not Applicable` resta incompleto anche quando la pagina contiene testo aziendale.

I lettori limitano le risposte a 4 MiB, rispettano `Retry-After` e distanziano le richieste di almeno un secondo. Errori delle liste e limiti di paginazione impediscono di dichiarare completa la raccolta; le fonti sane conservano i propri risultati.

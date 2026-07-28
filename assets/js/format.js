/**
 * Fmt — formattazione condivisa di date, orari e importi.
 *
 * Prima ogni pagina aveva il suo `formatDate` copiato a mano, quasi sempre
 * scritto come `new Date(str).toLocaleDateString('it-IT', …)`. Quella riga ha
 * tre difetti che in una pagina di gestionale si vedono davvero:
 *
 *  1. ANNO TRONCATO. Per gli anni sotto il 1000 `toLocaleDateString` stampa
 *     "26", non "0026". Una data corrotta (l'anno a due cifre digitato nel
 *     campo data del browser) in tabella sembrava quindi normale, mentre la
 *     stessa data in una KPI formattata a mano si mostrava per intero. Non era
 *     un bug di formattazione: era la formattazione che NASCONDEVA il dato
 *     sbagliato.
 *
 *  2. GIORNO SBAGLIATO. `new Date('2026-07-03')` non e' il 3 luglio locale: e'
 *     la mezzanotte UTC del 3 luglio. A fusi negativi si stampa il 2 luglio.
 *     Una scadenza o una data di lettura non devono spostarsi col fuso: sono
 *     giorni di calendario, non istanti.
 *
 *  3. "Invalid Date". MySQL restituisce i DATETIME come "2026-07-03 10:30:00",
 *     con lo spazio. Alcuni browser non lo accettano e stampano "Invalid Date"
 *     in mezzo alla tabella. Qualche file lo aggirava con `.replace(' ','T')`,
 *     altri no — e chi non lo faceva si rompeva solo su certi browser.
 *
 * Qui le date "di calendario" (solo giorno) sono trattate come locali e
 * formattate a mano, cosi' l'anno esce sempre a quattro cifre e il giorno non
 * scivola mai. Gli istanti veri (con fuso esplicito, es. "...Z") restano
 * istanti e vengono convertiti nell'ora locale, che e' quello che serve per un
 * log o per l'orario di un messaggio.
 *
 * Valore vuoto -> il trattino. Valore non interpretabile -> si stampa com'e',
 * mai "Invalid Date": se il dato e' sporco si deve vedere che e' sporco.
 */
(function (window) {
    'use strict';

    var EMPTY = '—';
    var MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
                  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    var WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

    function pad(n, len) {
        return String(Math.abs(n)).padStart(len || 2, '0');
    }

    /**
     * Costruisce una data LOCALE. Il giro con setFullYear e' necessario:
     * `new Date(26, 6, 3)` non e' l'anno 26, e' il 1926 — il costruttore mappa
     * gli anni 0-99 sul Novecento. Senza questo, una data corrotta col vecchio
     * anno a due cifre verrebbe silenziosamente "aggiustata".
     */
    function localDate(y, m, d, hh, mm, ss) {
        var date = new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0);
        date.setFullYear(y, m - 1, d);
        return date;
    }

    /**
     * Riconosce: Date, timestamp, "YYYY-MM-DD", "YYYY-MM-DD HH:MM(:SS)",
     * ISO con T, e ISO con fuso esplicito. Restituisce {date, dateOnly} oppure
     * null se non e' interpretabile.
     */
    function parse(value) {
        if (value === null || value === undefined || value === '') return null;

        if (value instanceof Date) {
            return isNaN(value.getTime()) ? null : { date: value, dateOnly: false };
        }

        if (typeof value === 'number') {
            var fromNum = new Date(value);
            return isNaN(fromNum.getTime()) ? null : { date: fromNum, dateOnly: false };
        }

        var s = String(value).trim();
        if (s === '' || s === EMPTY) return null;

        // "0000-00-00" e simili: MySQL li usa come "vuoto", non sono date.
        if (/^0{4}-0{2}-0{2}/.test(s)) return null;

        // Solo data: giorno di calendario, quindi locale.
        var m = /^(\d{1,6})-(\d{1,2})-(\d{1,2})$/.exec(s);
        if (m) {
            return { date: localDate(+m[1], +m[2], +m[3]), dateOnly: true };
        }

        // Data + ora senza fuso (il formato di MySQL): anche questa e' ora
        // locale dell'agenzia, non UTC. Lo spazio o la T sono equivalenti.
        m = /^(\d{1,6})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
        if (m) {
            return { date: localDate(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0)), dateOnly: false };
        }

        // Tutto il resto (ISO con Z o con offset) e' un istante vero.
        var parsed = new Date(s);
        return isNaN(parsed.getTime()) ? null : { date: parsed, dateOnly: false };
    }

    /**
     * Se non si riesce a interpretare, si restituisce il valore originale — ma
     * con i caratteri HTML neutralizzati. Quasi tutti i chiamanti infilano il
     * risultato in un template `innerHTML`, e alcuni degli helper che questo
     * modulo sostituisce passavano proprio da `esc()` sul ramo non valido:
     * restituire la stringa grezza aprirebbe un buco che prima non c'era. Sul
     * ramo normale non cambia nulla, una data e' fatta di cifre e barre.
     */
    function fallback(value) {
        if (value === null || value === undefined || value === '') return EMPTY;
        var s = String(value).trim();
        // "0000-00-00" e' il modo di MySQL di dire "vuoto": va reso come vuoto,
        // non ristampato tale e quale.
        if (s === '' || /^0{4}-0{2}-0{2}/.test(s)) return EMPTY;
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function formatWith(value, fn) {
        var p = parse(value);
        return p ? fn(p.date) : fallback(value);
    }

    var Fmt = {
        EMPTY: EMPTY,

        /** true se il valore e' una data interpretabile. */
        isValid: function (value) {
            return parse(value) !== null;
        },

        /** 03/07/2026 — l'anno sempre a quattro cifre, anche se e' 0026. */
        date: function (value) {
            return formatWith(value, function (d) {
                return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getFullYear(), 4);
            });
        },

        /** 03/07/2026 10:30 */
        dateTime: function (value) {
            return formatWith(value, function (d) {
                return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getFullYear(), 4)
                     + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
            });
        },

        /** 10:30 */
        time: function (value) {
            return formatWith(value, function (d) {
                return pad(d.getHours()) + ':' + pad(d.getMinutes());
            });
        },

        /** 03/07 — per le liste strette dove l'anno e' implicito. */
        dayMonth: function (value) {
            return formatWith(value, function (d) {
                return pad(d.getDate()) + '/' + pad(d.getMonth() + 1);
            });
        },

        /** 3 luglio 2026 */
        longDate: function (value) {
            return formatWith(value, function (d) {
                return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + pad(d.getFullYear(), 4);
            });
        },

        /** venerdì 3 luglio 2026 */
        weekdayDate: function (value) {
            return formatWith(value, function (d) {
                return WEEKDAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + pad(d.getFullYear(), 4);
            });
        },

        /** luglio 2026 */
        monthYear: function (value) {
            return formatWith(value, function (d) {
                return MONTHS[d.getMonth()] + ' ' + pad(d.getFullYear(), 4);
            });
        },

        /**
         * "YYYY-MM-DD" della data LOCALE, per i campi <input type="date">.
         * `toISOString().slice(0,10)` sembra equivalente ma restituisce la data
         * UTC: in Italia, fra mezzanotte e le 2, e' ancora il giorno prima — un
         * campo "oggi" che si apre su ieri.
         */
        toInput: function (value) {
            var p = value === undefined ? { date: new Date() } : parse(value);
            if (!p) return '';
            var d = p.date;
            return pad(d.getFullYear(), 4) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        },

        /** "YYYY-MM-DD" di oggi, ora locale. */
        today: function () {
            return Fmt.toInput();
        },

        /** "YYYY-MM-DDTHH:MM" locale, per <input type="datetime-local">. */
        toInputDateTime: function (value) {
            var p = value === undefined ? { date: new Date() } : parse(value);
            if (!p) return '';
            var d = p.date;
            return Fmt.toInput(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        },

        /** Giorni fra oggi e la data: negativo = passata. */
        daysFromToday: function (value) {
            var p = parse(value);
            if (!p) return null;
            var a = new Date(p.date.getFullYear(), p.date.getMonth(), p.date.getDate());
            var b = new Date();
            b = new Date(b.getFullYear(), b.getMonth(), b.getDate());
            return Math.round((a - b) / 86400000);
        },

        /**
         * € 1.234,56 — simbolo PRIMA del numero.
         *
         * La convenzione tipografica italiana lo vorrebbe dopo ("1.234,56 €"),
         * ed e' quello che produrrebbe `Intl` con style:'currency'. Ma tutta
         * l'app scrive "€ 1.234": spostare il simbolo ovunque sarebbe una
         * scelta di design, non la correzione di un difetto, e non e' una cosa
         * da far succedere di straforo dentro una pulizia della formattazione.
         * Qui si unifica il numero (raggruppamento e decimali), non l'aspetto.
         */
        money: function (value, opts) {
            var n = Number(value);
            if (value === null || value === undefined || value === '' || !isFinite(n)) {
                return (opts && opts.empty !== undefined) ? opts.empty : EMPTY;
            }
            var decimals = (opts && opts.decimals !== undefined) ? opts.decimals : 2;
            return '€ ' + new Intl.NumberFormat('it-IT', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
            }).format(n);
        },

        /** 1.234,5 — numeri non monetari (mq, consumi, contatori). */
        number: function (value, decimals) {
            var n = Number(value);
            if (value === null || value === undefined || value === '' || !isFinite(n)) return EMPTY;
            return new Intl.NumberFormat('it-IT', {
                minimumFractionDigits: decimals || 0,
                maximumFractionDigits: decimals === undefined ? 2 : decimals,
            }).format(n);
        },
    };

    window.Fmt = Fmt;
})(window);

/**
 * Provvigioni — schema della pagina "Nuova / Modifica provvigione".
 *
 * Sostituisce #commissions-modal in views/commissions.html.
 *
 * Due cose che il modale sbagliava, e che sono il motivo di questo file:
 *
 *  1. Il contratto si scriveva a mano. Il campo era un <input maxlength="50">
 *     etichettato "ID Contratto (opzionale)": chiedeva a una persona il numero
 *     di riga del database. Chi non lo sapeva lo lasciava vuoto, e la
 *     provvigione restava scollegata dall'affare — invisibile al conteggio che
 *     api/contracts.php fa per la scheda del contratto, e mostrata in elenco
 *     come un `#12` invece che col titolo del contratto.
 *
 *  2. Immobile e proprietario non erano nel modale, ma updateCommission() li
 *     riscrive lo stesso (UPDATE … property_id = :property_id, client_id =
 *     :client_id) e validateCommissionInput() li mette a null quando non
 *     arrivano nel body. Ogni modifica fatta dal modale svuotava quindi due
 *     colonne che nessuno aveva toccato. Il salvataggio è una sovrascrittura
 *     completa, non un merge: i campi stanno in schema anche quando sono rari.
 *
 * Lo stato (in sospeso / pagata) non è in schema di proposito: updateCommission()
 * conserva `status` e `paid_at` solo quando la chiave non arriva affatto
 * (array_key_exists), e la liquidazione si fa dal pulsante "Pagata" dell'elenco.
 * Mandare uno stato da qui vorrebbe dire riscrivere la data di pagamento a ogni
 * correzione di un importo. In cima alla sezione importo lo stato si legge, in
 * sola lettura.
 */

// api/commissions.php: COMMISSION_TYPES = ['vendita','locazione','affitto','gestione','altro'].
// Fuori da questa lista l'API risponde "Tipo commissione non valido".
export const COMMISSION_TYPES = [
    { value: 'vendita',   label: 'Vendita' },
    { value: 'locazione', label: 'Locazione' },
    { value: 'affitto',   label: 'Affitto' },
    { value: 'gestione',  label: 'Gestione' },
    { value: 'altro',     label: 'Altro' },
];

// api/commissions.php: COMMISSION_AGENT_ROLES = ['unico','acquisitore','venditore'].
// 'unico' non compare qui: l'API traduce il campo vuoto in 'unico'
// (`trim($data['agent_role'] ?? '') ?: 'unico'`), quindi la voce vuota della
// tendina È già la provvigione intera. Metterla due volte — una come opzione e
// una come etichetta del vuoto — direbbe la stessa cosa con due righe diverse.
export const AGENT_ROLES = [
    { value: 'acquisitore', label: 'Acquisitore — ha preso il mandato' },
    { value: 'venditore',   label: 'Venditore — ha portato la controparte' },
];

const STATUS_LABELS = { pending: 'In sospeso', paid: 'Pagata', cancelled: 'Annullata' };

export default {
    entity:   'commissions',
    api:      'api/commissions.php',
    listView: 'commissions',
    icon:     'briefcase',
    titles:   { create: 'Nuova Provvigione', edit: 'Modifica Provvigione' },
    subtitle: 'Compenso dell\'agente su un affare: quanto, su quale contratto e quando va liquidato.',

    // Il record arriva con agent_role = 'unico' anche quando nessuno ha
    // dichiarato uno split. La tendina rappresenta quel caso con la voce vuota
    // (vedi AGENT_ROLES), quindi il valore va riportato lì, altrimenti il select
    // resta senza opzione corrispondente e si apre bianco.
    afterLoad(data) {
        if (data && data.agent_role === 'unico') data.agent_role = '';
        return data;
    },

    sections: [
        {
            legend: 'Agente e affare',
            hint: 'Chi ha fatto l\'affare, a che titolo e su quale contratto.',
            fields: [
                {
                    name: 'admin_user_id', label: 'Agente', type: 'select',
                    source: 'agents', required: true, span: 5, autofocus: true,
                    emptyLabel: '— Seleziona agente —',
                },
                {
                    name: 'agent_role', label: 'Ruolo sull\'affare', type: 'select',
                    options: AGENT_ROLES, span: 4, emptyLabel: 'Provvigione intera',
                    hint: 'Serve solo quando l\'affare è diviso fra due agenti: due righe sullo stesso contratto, una per ruolo. Altrimenti lascia "Provvigione intera".',
                },
                {
                    name: 'commission_type', label: 'Tipo', type: 'select',
                    options: COMMISSION_TYPES, required: true, span: 3,
                    emptyLabel: '— Seleziona tipo —',
                },
                {
                    name: 'contract_id', label: 'Contratto', type: 'picker',
                    source: 'contracts', span: 12,
                    placeholder: 'Cerca per indirizzo o numero contratto…',
                    hint: 'Collegandolo, la provvigione compare nella scheda del contratto e l\'elenco mostra il titolo dell\'affare invece del numero di riga.',
                },
            ],
        },
        {
            legend: 'Importo e scadenza',
            fields: [
                {
                    name: 'amount', label: 'Importo', type: 'money',
                    required: true, min: 0, span: 3, prefix: '€',
                    placeholder: '0,00',
                },
                {
                    name: 'percentage', label: 'Percentuale', type: 'number',
                    min: 0, max: 100, span: 3, suffix: '%',
                    hint: 'Solo memoria di come si è arrivati all\'importo: nessuno rifà il calcolo.',
                },
                {
                    name: 'due_date', label: 'Scadenza', type: 'date', span: 3,
                    labelHint: 'quando va liquidata all\'agente',
                },
                {
                    // Sola lettura: la liquidazione si fa dall'elenco (PATCH), non da qui.
                    name: 'status', label: 'Stato', type: 'static', span: 3,
                    labelHint: 'si cambia dall\'elenco',
                    render: (d) => {
                        if (!d || !d.status) return '—';
                        if (d.status === 'paid') {
                            return d.paid_at ? `Pagata il ${window.Fmt.dateTime(d.paid_at)}` : 'Pagata';
                        }
                        return STATUS_LABELS[d.status] || d.status;
                    },
                },
            ],
        },
        {
            legend: 'Note',
            fields: [
                {
                    name: 'notes', label: 'Note', type: 'textarea', rows: 3, span: 12,
                    placeholder: 'Accordi sulla divisione, condizioni di pagamento, a chi va fatturata…',
                },
            ],
        },
        {
            // Chiusa perché quasi sempre il contratto basta — ma i due campi
            // devono comunque esistere: il PUT riscrive tutte le colonne, e un
            // campo che non arriva nel body viene salvato come null.
            legend: 'Immobile e proprietario',
            fold: true,
            optionalNote: 'quasi sempre basta il contratto',
            hint: 'Da compilare quando la provvigione non nasce da un contratto registrato: una mediazione chiusa a voce, un incarico su un immobile ancora libero.',
            fields: [
                {
                    name: 'property_id', label: 'Immobile', type: 'picker',
                    source: 'properties', span: 6,
                    placeholder: 'Cerca per riferimento, indirizzo o città…',
                },
                {
                    name: 'client_id', label: 'Proprietario', type: 'picker',
                    source: 'clients', span: 6,
                    placeholder: 'Cerca per nome o ragione sociale…',
                },
            ],
        },
    ],
};

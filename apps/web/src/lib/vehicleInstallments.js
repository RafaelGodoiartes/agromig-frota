// Position confirmed by the manager on 08/10/2026. Initial months are estimates.
export const VEHICLE_INSTALLMENTS = Object.freeze([
    { id: 'hyundai', name: 'Escavadeira Hyundai', paid: 17, total: 77, currentCents: null },
    { id: 'jcb', name: '2 Retroescavadeiras JCB', paid: 19, total: 79, currentCents: null },
    { id: 'l200', name: '3 Mitsubishi L200', paid: 10, total: 55, currentCents: null },
    { id: 'prancha', name: 'Prancha — Consórcio', paid: 27, total: 100, currentCents: 525928 },
]);

export function installmentCalendar(contract, today) {
    const referenceMonth = 2026 * 12 + 9; // October, last paid month assumed for estimating only.
    const firstMonth = referenceMonth - contract.paid + 1;
    return Array.from({ length: contract.total }, (_, index) => {
        const month = firstMonth + index;
        const dueDate = `${Math.floor(month / 12)}-${String(month % 12 + 1).padStart(2, '0')}-01`;
        const confirmedPaid = index < contract.paid;
        return {
            number: index + 1,
            dueDate,
            status: confirmedPaid ? 'Paga — posição confirmada' : dueDate < today ? 'Vencida e não paga' : 'A vencer',
            confirmedPaid,
            // Current price is only a projection for remaining installments, not historical proof.
            projectedCents: confirmedPaid ? null : contract.currentCents,
        };
    });
}

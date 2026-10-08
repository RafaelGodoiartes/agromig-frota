import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_INSTALLMENTS, installmentCalendar } from './vehicleInstallments.js';

test('confirmed counts, estimated initial months and every due date on day 01', () => {
    const starts = ['2025-06-01', '2025-04-01', '2026-01-01', '2024-08-01'];
    const remaining = [60, 60, 45, 73];
    VEHICLE_INSTALLMENTS.forEach((contract, index) => {
        const rows = installmentCalendar(contract, '2026-10-08');
        assert.equal(rows.length, contract.total);
        assert.equal(rows[0].dueDate, starts[index]);
        assert.equal(rows.filter(row => row.confirmedPaid).length, contract.paid);
        assert.equal(rows.filter(row => !row.confirmedPaid).length, remaining[index]);
        assert.ok(rows.every(row => row.dueDate.endsWith('-01')));
        assert.equal(rows[contract.paid].dueDate, '2026-11-01');
    });
});

test('passed due dates do not turn unpaid installments into paid ones', () => {
    const rows = installmentCalendar(VEHICLE_INSTALLMENTS[3], '2026-12-02');
    assert.equal(rows[27].status, 'Vencida e não paga');
    assert.equal(rows.filter(row => row.confirmedPaid).length, 27);
    assert.equal(rows[27].projectedCents, 525928);
    assert.equal(rows[26].projectedCents, null);
    assert.equal(installmentCalendar(VEHICLE_INSTALLMENTS[0], '2026-10-08')[17].projectedCents, null);
});

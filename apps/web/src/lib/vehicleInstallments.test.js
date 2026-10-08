import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_INSTALLMENTS, installmentCalendar, resolveInstallmentAmounts } from './vehicleInstallments.js';

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

test('live registry prices sum only financed own vehicles once and respond to changes', () => {
    const row = (placa, parcelaMensal, tipoPosse = 'Próprio') => ({ placa, parcelaMensal, tipoPosse });
    const source = [row('TEQ1D19', 100), row('TEO9H16', 200), row('TEQ4H56', 300), row('TEQ4H56', 300), row('SFV3J60', 999), row('SOR3CXTTER3423582', 50), row('SOR3CXTTER3423584', 70), row('HBRBE440TR0085665', 150)];
    const amounts = resolveInstallmentAmounts(source);
    assert.equal(amounts.find(c => c.id === 'l200').currentCents, 60000);
    assert.equal(amounts.find(c => c.id === 'jcb').currentCents, 12000);
    assert.equal(amounts.find(c => c.id === 'hyundai').currentCents, 15000);
    source[0].parcelaMensal = 110;
    assert.equal(resolveInstallmentAmounts(source)[2].currentCents, 61000);
    source[0].tipoPosse = 'Locado';
    assert.equal(resolveInstallmentAmounts(source)[2].currentCents, null);
    assert.equal(resolveInstallmentAmounts([])[0].currentCents, null);
    assert.equal(resolveInstallmentAmounts([])[3].currentCents, 525928);
    assert.equal(resolveInstallmentAmounts([...source, row('HBRBE440TR0085665', 160)])[0].currentCents, null);
});

test('passed due dates do not turn unpaid installments into paid ones', () => {
    const rows = installmentCalendar(VEHICLE_INSTALLMENTS[3], '2026-12-02');
    assert.equal(rows[27].status, 'Vencida e não paga');
    assert.equal(rows.filter(row => row.confirmedPaid).length, 27);
    assert.equal(rows[27].projectedCents, 525928);
    assert.equal(rows[26].projectedCents, null);
    assert.equal(installmentCalendar(VEHICLE_INSTALLMENTS[0], '2026-10-08')[17].projectedCents, null);
});

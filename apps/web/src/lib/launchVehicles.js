export const launchPlateKey = (value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

// Fuel catalogue stays first; canonical/newly registered vehicles complement it.
// The canonical registry persists new plates across refreshes and other browsers.
export function mergeLaunchVehicles(...lists) {
    const result = new Map();
    for (const list of lists) for (const vehicle of list || []) {
        const key = launchPlateKey(vehicle.placa);
        if (!key) continue;
        const old = result.get(key);
        if (!old) result.set(key, vehicle);
        else result.set(key, { ...vehicle, ...Object.fromEntries(Object.entries(old).filter(([, value]) => value !== '' && value != null)) });
    }
    return [...result.values()];
}

export function registrationVehicle(form) {
    const plate = String(form.placa || '').trim().toUpperCase();
    return { placa: /^[A-Z]{3}[-\s]?\d[A-Z0-9]\d{2}$/.test(plate) ? launchPlateKey(plate) : plate, veiculo: String(form.veiculo || '').trim(),
        projeto: String(form.projeto || '').trim(), tipoPosse: form.tipoPosse || form.propriedade,
        propriedade: form.propriedade, unidade: form.unidade || 'KM', pastaEvidencias: form.folderUrl || '' };
}

export function registeredVehicleMetadata(data, plate, supplied = {}, fuel = false) {
    const sources = fuel
        ? [data?.veiculosAbastecimento, data?.veiculos]
        : [data?.veiculos, data?.veiculosAbastecimento];
    return mergeLaunchVehicles(...sources).find(vehicle => launchPlateKey(vehicle.placa) === launchPlateKey(plate))
        || { placa: plate, veiculo: supplied.veiculo || plate, unidade: supplied.unidade || 'KM',
            tipoPosse: supplied.tipoPosse || '', pastaEvidencias: supplied.pastaEvidencias || '' };
}

export function selectRegisteredVehicle(form, vehicle) {
    return { ...form, placa: vehicle.placa, projeto: vehicle.projeto || form.projeto,
        folderUrl: vehicle.pastaEvidencias || '' };
}

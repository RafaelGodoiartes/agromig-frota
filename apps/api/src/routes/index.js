import { Router } from 'express';
import healthCheck from './health-check.js';
import fleetHandler, { fleetRefreshHandler, createAbastecimentoHandler, createManutencaoHandler, createKmSemanalHandler, createVeiculoHandler } from './fleet.js';

const router = Router();

export default () => {
    router.get('/health', healthCheck);
    router.get('/fleet', fleetHandler);
    router.get('/fleet/refresh', fleetRefreshHandler);
    router.post('/fleet/abastecimento', createAbastecimentoHandler);
    router.post('/fleet/manutencao', createManutencaoHandler);
    router.post('/fleet/km-semanal', createKmSemanalHandler);
    router.post('/fleet/veiculo', createVeiculoHandler);

    return router;
};


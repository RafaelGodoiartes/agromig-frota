import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import routes from './routes/index.js';
import { errorMiddleware } from './middleware/error.js';
import { globalRateLimit } from './middleware/global-rate-limit.js';
import { BodyLimit } from './constants/common.js';

const app = express();

app.set('trust proxy', true);
app.use(helmet());
app.use(cors({
	origin: process.env.CORS_ORIGIN || false,
	methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'QUERY'],
	allowedHeaders: ['Authorization', 'Content-Type'],
}));
app.use(morgan('combined'));
app.use(globalRateLimit);
app.use(express.json({ limit: BodyLimit }));
app.use(express.urlencoded({
	extended: true,
	limit: BodyLimit,
}));

// Horizons calls its API through /hcgi/api. Keep root routes too for local API use.
app.use('/hcgi/api', routes());
app.use('/', routes());

app.use(errorMiddleware);
app.use((req, res) => {
	res.status(404).json({ error: 'Route not found' });
});

export default app;
